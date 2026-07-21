const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function chunk(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function selectAll(client, table, orderColumn = "created_at") {
  const { data, error } = await client.from(table).select("*").order(orderColumn, { ascending: true });
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return data ?? [];
}

async function deleteAll(client, table) {
  const { error } = await client.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
}

async function insertRows(client, table, rows) {
  if (!rows.length) return;
  for (const rowsChunk of chunk(rows)) {
    const { error } = await client.from(table).insert(rowsChunk);
    if (error) throw new Error(`Could not insert ${table}: ${error.message}`);
  }
}

async function findDevUser(dev, email) {
  const { data, error } = await dev.auth.admin.listUsers();
  if (error) throw new Error(`Could not list dev auth users: ${error.message}`);
  const users = data?.users ?? [];
  if (email) {
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (!match) throw new Error(`No dev auth user found for ${email}. Sign into local once, then rerun this script.`);
    return match;
  }
  if (users.length === 1) return users[0];
  throw new Error("Set DEV_USER_EMAIL in .env.copy.local so I know which dev user should own the copied data.");
}

async function main() {
  loadEnvFile(".env.copy.local");

  const prod = createClient(required("PROD_SUPABASE_URL"), required("PROD_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const dev = createClient(required("DEV_SUPABASE_URL"), required("DEV_SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const devUser = await findDevUser(dev, process.env.DEV_USER_EMAIL);

  const [prodLeagues, prodSessions, prodTeams, prodPicks] = await Promise.all([
    selectAll(prod, "leagues"),
    selectAll(prod, "draft_sessions"),
    selectAll(prod, "draft_teams"),
    selectAll(prod, "draft_picks"),
  ]);

  console.log(`Read ${prodLeagues.length} leagues, ${prodSessions.length} sessions, ${prodTeams.length} teams, ${prodPicks.length} picks from prod.`);

  await deleteAll(dev, "draft_picks");
  await deleteAll(dev, "draft_teams");
  await deleteAll(dev, "draft_sessions");
  await deleteAll(dev, "league_memberships");
  await deleteAll(dev, "leagues");

  const devProfileResult = await dev
    .from("profiles")
    .upsert({
      id: devUser.id,
      username: devUser.user_metadata?.username || devUser.email?.split("@")[0] || "Dev Commissioner",
      role: "commissioner",
      site_role: "site_admin",
    }, { onConflict: "id" })
    .select("*")
    .single();
  if (devProfileResult.error) throw new Error(`Could not upsert dev profile: ${devProfileResult.error.message}`);

  const leagues = prodLeagues.map((league, index) => ({
    ...league,
    created_by: index === 0 ? devUser.id : null,
  }));
  await insertRows(dev, "leagues", leagues);

  const defaultLeagueId = leagues.find((league) => league.slug === "rat-race-golf")?.id ?? leagues[0]?.id;
  if (defaultLeagueId) {
    const { error: profileUpdateError } = await dev.from("profiles").update({ active_league_id: defaultLeagueId }).eq("id", devUser.id);
    if (profileUpdateError) throw new Error(`Could not set dev active league: ${profileUpdateError.message}`);
  }

  const memberships = leagues.map((league) => ({
    league_id: league.id,
    user_id: devUser.id,
    role: "commissioner",
  }));
  await insertRows(dev, "league_memberships", memberships);

  const sessions = prodSessions.map((session) => ({
    ...session,
    commissioner_id: devUser.id,
  }));
  await insertRows(dev, "draft_sessions", sessions);

  const teams = prodTeams.map((team) => ({
    ...team,
    owner_user_id: null,
  }));
  await insertRows(dev, "draft_teams", teams);
  await insertRows(dev, "draft_picks", prodPicks);

  console.log("Copied prod league/draft data into dev. Auth users/passwords were not copied.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
