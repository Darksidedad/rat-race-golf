"use client";

import type { KeyboardEvent } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type EventOption = { id: string; name: string };
type DraftSession = {
  id: string;
  name: string;
  event_id: string | null;
  event_name: string | null;
  player_input: string;
  manual_leaderboard_input: string | null;
  current_positions: Record<string, number | null> | null;
  status: string;
  commissioner_id: string | null;
  created_at: string;
  updated_at: string;
};
type DraftTeam = { id: string; session_id: string; name: string; draft_slot: number | null; active: boolean; owner_user_id: string | null; created_at: string };
type DraftPick = { id: string; session_id: string; team_id: string; player_name: string; player_key: string; pick_number: number; round_number: number; created_at: string };
type Profile = { id: string; username: string; team_name: string | null; role: "commissioner" | "member"; created_at: string };
type EspnEventsResponse = { ok: boolean; events?: EventOption[]; error?: string };
type EspnFieldResponse = { ok: boolean; eventName?: string; players?: string[]; error?: string };
type EspnLeaderboardResponse = { ok: boolean; eventName?: string; leaderboard?: Record<string, number | null>; error?: string };
type EspnOddsResponse = { ok: boolean; eventName?: string; odds?: Record<string, number>; source?: string; error?: string };
  type RoomTab = "setup" | "admin" | "draft" | "results";
type EditingPick = {
  id: string;
  teamName: string;
  playerName: string;
};

const ROUNDS = 4;
const DEFAULT_TEAM_NAMES = ["Ryan","Morris","Russ","Swany","Capps","Seth","Jay","Teron","Jesse","Drew","Jimmy","Jones"];
const INVALID_PLAYER_TERMS = [
  "driving",
  "distance",
  "accuracy",
  "average",
  "leaderboard",
  "statistics",
  "stats",
  "position",
  "round",
  "score",
  "projected",
  "odds",
  "performance",
  "totals",
];

function normalizeName(name: string) {
  return name.toLowerCase().replace(/\./g, "").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

function parseManualLeaderboard(input: string) {
  const result: Record<string, number | null> = {};
  input.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const match = line.match(/^(T?\d+|CUT|WD|DQ)\s+(.+)$/i);
    if (!match) return;
    const raw = match[1].toUpperCase();
    result[normalizeName(match[2].trim())] = raw === "CUT" || raw === "WD" || raw === "DQ" ? null : Number(raw.replace("T", ""));
  });
  return result;
}

function pointsForPosition(position: number | null) {
  return position === null || position < 1 ? 0 : Math.max(0, 51 - position);
}

function getAssignedActiveTeams(teams: DraftTeam[]) {
  return teams.filter((team) => team.draft_slot !== null).sort((a, b) => (a.draft_slot ?? 0) - (b.draft_slot ?? 0));
}

function nextAvailableDraftSlot(teams: DraftTeam[]) {
  const usedSlots = new Set(teams.map((team) => team.draft_slot).filter((slot): slot is number => slot !== null));
  let nextSlot = 1;
  while (usedSlots.has(nextSlot)) nextSlot += 1;
  return nextSlot;
}

function hasValidDraftOrder(teams: DraftTeam[]) {
  const assigned = getAssignedActiveTeams(teams);
  return !!assigned.length && assigned.every((team, index) => team.draft_slot === index + 1);
}

function getCurrentTeamOnClock(teams: DraftTeam[], picks: DraftPick[]) {
  const assigned = getAssignedActiveTeams(teams);
  if (!assigned.length || picks.length >= assigned.length * ROUNDS) return null;
  const round = Math.floor(picks.length / assigned.length) + 1;
  const index = picks.length % assigned.length;
  return round % 2 === 1 ? assigned[index] : assigned[assigned.length - 1 - index];
}

function statusLabel(status: string) {
  return status.replace(/[_-]/g, " ");
}

function sanitizePlayerNames(players: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const rawPlayer of players) {
    const player = rawPlayer.replace(/\s+/g, " ").trim();
    const key = normalizeName(player);

    if (!player || seen.has(key)) continue;
    if (player.length < 4 || player.length > 40) continue;
    if (!/[a-z]/i.test(player) || /\d/.test(player)) continue;
    if (player.split(" ").length < 2 || player.split(" ").length > 4) continue;
    if (INVALID_PLAYER_TERMS.some((term) => key.includes(term))) continue;

    seen.add(key);
    cleaned.push(player);
  }

  return cleaned;
}

export default function Page() {
  const [sessions, setSessions] = useState<DraftSession[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [currentSession, setCurrentSession] = useState<DraftSession | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionEventId, setNewSessionEventId] = useState("");
  const [playerPoolDraft, setPlayerPoolDraft] = useState("");
  const [manualLeaderboardDraft, setManualLeaderboardDraft] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authTeamName, setAuthTeamName] = useState(DEFAULT_TEAM_NAMES[0]);
  const [statusMessage, setStatusMessage] = useState("Loading league data...");
  const [busy, setBusy] = useState("");
  const [activeRoomTab, setActiveRoomTab] = useState<RoomTab>("draft");
  const [editingPick, setEditingPick] = useState<EditingPick | null>(null);
  const [highlightedPlayerIndex, setHighlightedPlayerIndex] = useState(0);
  const [oddsByPlayer, setOddsByPlayer] = useState<Record<string, number>>({});
  const [oddsSource, setOddsSource] = useState("");
  const deferredFilter = useDeferredValue(playerFilter);

  useEffect(() => {
    loadEvents();
    initializeAuth();
  }, []);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setUser(nextSession?.user ?? null);
      setAuthChecked(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!user) {
      setProfile(null);
      setSessions([]);
      setCurrentSession(null);
      setTeams([]);
      setPicks([]);
      setSelectedSessionId("");
      setStatusMessage("Sign in to access the league.");
      return;
    }

    loadProfile(user.id);
    loadSessions();
  }, [authChecked, user]);

  useEffect(() => {
    if (!selectedSessionId && sessions[0]?.id) setSelectedSessionId(sessions[0].id);
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (!user) return;
    loadSession(selectedSessionId);
    const channel = supabase
      .channel(`draft-${selectedSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${selectedSessionId}` }, () => { loadSessions(); loadSession(selectedSessionId); })
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_teams", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSessionId, user]);

  useEffect(() => {
    setPlayerPoolDraft(currentSession?.player_input ?? "");
    setManualLeaderboardDraft(currentSession?.manual_leaderboard_input ?? "");
  }, [currentSession?.id, currentSession?.player_input, currentSession?.manual_leaderboard_input]);

  useEffect(() => {
    if (!currentSession?.event_name) {
      setOddsByPlayer({});
      setOddsSource("");
      return;
    }
    loadOdds(currentSession.event_name);
  }, [currentSession?.event_name]);

  useEffect(() => {
    if (!profile || profile.role === "commissioner") return;
    if (activeRoomTab === "setup" || activeRoomTab === "admin") {
      setActiveRoomTab("draft");
    }
  }, [activeRoomTab, profile]);

  const assignedTeams = useMemo(() => getAssignedActiveTeams(teams), [teams]);
  const validDraftOrder = useMemo(() => hasValidDraftOrder(teams), [teams]);
  const currentTeamOnClock = useMemo(() => (validDraftOrder ? getCurrentTeamOnClock(teams, picks) : null), [teams, picks, validDraftOrder]);
  const draftedKeys = useMemo(() => new Set(picks.map((pick) => pick.player_key)), [picks]);
  const allPlayers = useMemo(() => sanitizePlayerNames(playerPoolDraft.split("\n")), [playerPoolDraft]);
  const availablePlayers = useMemo(() => allPlayers
    .filter((player) => !draftedKeys.has(normalizeName(player)))
    .filter((player) => player.toLowerCase().includes(deferredFilter.toLowerCase()))
    .sort((a, b) => {
      const aOdds = oddsByPlayer[normalizeName(a)] ?? Number.POSITIVE_INFINITY;
      const bOdds = oddsByPlayer[normalizeName(b)] ?? Number.POSITIVE_INFINITY;
      if (aOdds !== bOdds) return aOdds - bOdds;
      return a.localeCompare(b);
    }), [allPlayers, draftedKeys, deferredFilter, oddsByPlayer]);
  const unassignedTeams = useMemo(() => teams.filter((team) => team.draft_slot === null).sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const totalPicks = assignedTeams.length * ROUNDS;
  const draftComplete = totalPicks > 0 && picks.length >= totalPicks;
  const currentRound = assignedTeams.length ? Math.floor(picks.length / assignedTeams.length) + 1 : 0;
  const draftBoardRounds = useMemo(() => {
    return Array.from({ length: ROUNDS }, (_, roundIndex) => {
      const roundNumber = roundIndex + 1;
      const order = roundNumber % 2 === 1 ? assignedTeams : [...assignedTeams].reverse();
      return {
        roundNumber,
        cells: order.map((team, pickIndex) => {
          const pick = picks.find((entry) => entry.team_id === team.id && entry.round_number === roundNumber) ?? null;
          const overallPick = roundIndex * assignedTeams.length + pickIndex + 1;
          const isOnClock = !draftComplete && validDraftOrder && currentTeamOnClock?.id === team.id && currentRound === roundNumber && picks.length === overallPick - 1;
          return { team, pick, overallPick, isOnClock };
        }),
      };
    });
  }, [assignedTeams, currentRound, currentTeamOnClock, draftComplete, picks, validDraftOrder]);
  const leaderboard = useMemo(() => {
    const positions = currentSession?.current_positions ?? {};
    return assignedTeams.map((team) => {
      const playerScores = picks.filter((pick) => pick.team_id === team.id).map((pick) => {
        const position = positions[pick.player_key] ?? null;
        return { ...pick, position, points: pointsForPosition(position) };
      });
      const total = [...playerScores].map((player) => player.points).sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
      const countingKeys = new Set(
        [...playerScores]
          .sort((a, b) => b.points - a.points)
          .slice(0, 3)
          .map((player) => player.id)
      );
      return { team, playerScores, total, countingKeys };
    }).sort((a, b) => b.total - a.total);
  }, [assignedTeams, currentSession?.current_positions, picks]);
  const resultsUpdatedLabel = useMemo(() => {
    if (!currentSession?.updated_at) return "Not updated yet";
    return new Date(currentSession.updated_at).toLocaleString();
  }, [currentSession?.updated_at]);
  const isCommissioner = profile?.role === "commissioner";
  const currentUsersTeams = useMemo(() => teams.filter((team) => team.owner_user_id === user?.id), [teams, user?.id]);
  const canDraftCurrentPick = !!user && !!currentTeamOnClock && (isCommissioner || currentTeamOnClock.owner_user_id === user.id);
  const canManageLeague = !!user && isCommissioner;
  const ownedTeamNames = currentUsersTeams.map((team) => team.name);

  useEffect(() => {
    if (!availablePlayers.length) {
      setHighlightedPlayerIndex(0);
      return;
    }
    setHighlightedPlayerIndex((current) => Math.min(current, availablePlayers.length - 1));
  }, [availablePlayers]);

  async function initializeAuth() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error(error);
      setAuthChecked(true);
      setStatusMessage("Could not load your sign-in session.");
      return;
    }

    setUser(data.session?.user ?? null);
    setAuthChecked(true);
  }

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.error(error);
      setStatusMessage("Could not load your league profile.");
      return;
    }

    setProfile((data as Profile | null) ?? null);
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword) {
      setStatusMessage("Enter your email and password to sign in.");
      return;
    }

    setBusy("Signing in...");
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not sign you in.");
      return;
    }

    setStatusMessage("Signed in.");
  }

  async function signUp() {
    if (!authUsername.trim()) {
      setStatusMessage("Choose a username before creating your account.");
      return;
    }
    if (!authEmail.trim() || !authPassword) {
      setStatusMessage("Enter your email and password before creating your account.");
      return;
    }
    if (!authTeamName.trim()) {
      setStatusMessage("Choose your team before creating your account.");
      return;
    }

    setBusy("Creating account...");
    const { error } = await supabase.auth.signUp({
      email: authEmail.trim(),
      password: authPassword,
      options: {
        data: {
          username: authUsername.trim(),
          team_name: authTeamName.trim(),
        },
      },
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not create your account.");
      return;
    }

    setStatusMessage("Account created. If your project requires email confirmation, verify your email and then sign in.");
  }

  async function signOut() {
    setBusy("Signing out...");
    const { error } = await supabase.auth.signOut();
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage("Could not sign you out.");
      return;
    }

    setStatusMessage("Signed out.");
  }

  async function loadSessions() {
    const { data, error } = await supabase.from("draft_sessions").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setStatusMessage("Could not load tournament sessions from Supabase.");
      return;
    }
    setSessions((data ?? []) as DraftSession[]);
  }

  async function loadSession(sessionId: string, setLoading = true) {
    if (setLoading) setBusy("Loading session...");
    const [sessionResult, teamsResult, picksResult] = await Promise.all([
      supabase.from("draft_sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("draft_teams").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      supabase.from("draft_picks").select("*").eq("session_id", sessionId).order("pick_number", { ascending: true }),
    ]);
    if (sessionResult.error || teamsResult.error || picksResult.error) {
      console.error(sessionResult.error, teamsResult.error, picksResult.error);
      setStatusMessage("Could not load the selected draft session.");
      setBusy("");
      return;
    }
    setCurrentSession((sessionResult.data as DraftSession | null) ?? null);
    setTeams((teamsResult.data as DraftTeam[]) ?? []);
    setPicks((picksResult.data as DraftPick[]) ?? []);
    setBusy("");
  }

  async function loadEvents() {
    try {
      const response = await fetch("/api/espn-golf?action=events");
      const payload: EspnEventsResponse = await response.json();
      if (!payload.ok || !payload.events) throw new Error(payload.error);
      setEvents(payload.events);
      if (!newSessionEventId && payload.events[0]?.id) setNewSessionEventId(payload.events[0].id);
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not load PGA events from ESPN.");
    }
  }

  async function loadOdds(eventName: string) {
    try {
      const response = await fetch(`/api/espn-golf?action=odds&eventName=${encodeURIComponent(eventName)}`);
      const payload: EspnOddsResponse = await response.json();
      if (!payload.ok || !payload.odds) {
        setOddsByPlayer({});
        setOddsSource("");
        return;
      }
      setOddsByPlayer(payload.odds);
      setOddsSource(payload.source ?? "");
    } catch (error) {
      console.error(error);
      setOddsByPlayer({});
      setOddsSource("");
    }
  }

  async function updateSession(patch: Partial<DraftSession>, message: string) {
    if (!currentSession) return false;
    const { error } = await supabase.from("draft_sessions").update(patch).eq("id", currentSession.id);
    if (error) {
      console.error(error);
      setStatusMessage("Could not save the tournament changes.");
      return false;
    }
    setStatusMessage(message);
    await loadSessions();
    await loadSession(currentSession.id, false);
    return true;
  }

  async function updateTeam(teamId: string, patch: Partial<DraftTeam>, message?: string) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can edit teams and draft order.");
      return false;
    }
    const { error } = await supabase.from("draft_teams").update(patch).eq("id", teamId);
    if (error) {
      console.error(error);
      setStatusMessage("Could not save the team update.");
      return false;
    }
    if (message) setStatusMessage(message);
    return true;
  }

  async function addTeam() {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can add teams.");
      return;
    }
    if (!currentSession) return;

    const trimmedName = newTeamName.trim();
    if (!trimmedName) {
      setStatusMessage("Type a team name before adding a new team.");
      return;
    }

    if (teams.some((team) => normalizeName(team.name) === normalizeName(trimmedName))) {
      setStatusMessage("That team name already exists.");
      return;
    }

    setBusy("Adding team...");
    const { error } = await supabase.from("draft_teams").insert([
      {
        session_id: currentSession.id,
        name: trimmedName,
        draft_slot: null,
        active: false,
      },
    ]);

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not add the new team.");
      return;
    }

    setNewTeamName("");
    setBusy("");
    setStatusMessage(`Added team "${trimmedName}".`);
    await loadSession(currentSession.id, false);
  }

  async function deleteTeam(team: DraftTeam) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can delete teams.");
      return;
    }
    if (team.draft_slot !== null) {
      setStatusMessage("Remove that team from the draft order before deleting it.");
      return;
    }

    setBusy("Deleting team...");
    const { error } = await supabase.from("draft_teams").delete().eq("id", team.id);

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not delete that team.");
      return;
    }

    setBusy("");
    setStatusMessage(`Deleted team "${team.name}".`);
    await loadSession(selectedSessionId, false);
  }

  async function deleteSession(session: DraftSession) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can delete sessions.");
      return;
    }
    if (!window.confirm(`Delete "${session.name}"? This removes the session, draft order, picks, and saved scoring.`)) return;
    setBusy("Deleting session...");
    const { error } = await supabase.from("draft_sessions").delete().eq("id", session.id);
    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not delete that session.");
      return;
    }
    setSelectedSessionId((current) => current === session.id ? "" : current);
    setBusy("");
    setStatusMessage(`Deleted session "${session.name}".`);
    await loadSessions();
  }

  async function createSession() {
    if (!canManageLeague || !user) return setStatusMessage("Only the commissioner can create new tournament sessions.");
    const trimmedName = newSessionName.trim();
    if (!trimmedName) return setStatusMessage("Type a tournament name before creating a session.");
    setBusy("Creating session...");
    const event = events.find((item) => item.id === newSessionEventId) ?? null;
    const sessionInsert = await supabase.from("draft_sessions").insert([{ name: trimmedName, event_id: event?.id ?? null, event_name: event?.name ?? null, player_input: "", manual_leaderboard_input: "", current_positions: {}, status: "setup", commissioner_id: user.id }]).select("*").single();
    if (sessionInsert.error || !sessionInsert.data) {
      console.error(sessionInsert.error);
      setBusy("");
      return setStatusMessage("Could not create the tournament session.");
    }
    const profileResult = await supabase.from("profiles").select("id, team_name").not("team_name", "is", null);
    const ownerByTeam = new Map(
      (((profileResult.data ?? []) as Pick<Profile, "id" | "team_name">[])
        .filter((entry): entry is Pick<Profile, "id" | "team_name"> & { team_name: string } => !!entry.team_name)
        .map((entry) => [normalizeName(entry.team_name), entry.id]))
    );
    const teamsInsert = await supabase.from("draft_teams").insert(DEFAULT_TEAM_NAMES.map((name) => ({
      session_id: sessionInsert.data.id,
      name,
      draft_slot: null,
      active: false,
      owner_user_id: ownerByTeam.get(normalizeName(name)) ?? null,
    })));
    if (teamsInsert.error) {
      console.error(teamsInsert.error);
      setBusy("");
      return setStatusMessage("The session was created, but the teams were not saved.");
    }
    setNewSessionName("");
    setSelectedSessionId(sessionInsert.data.id);
    setStatusMessage(`Created live draft session "${sessionInsert.data.name}".`);
    setBusy("");
    await loadSessions();
  }

  async function assignNextPick(team: DraftTeam) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can change the draft order.");
    const nextSlot = nextAvailableDraftSlot(teams);
    await updateTeam(team.id, { draft_slot: nextSlot, active: true }, `${team.name} is now pick ${nextSlot}.`);
    await loadSession(selectedSessionId, false);
  }

  async function normalizeDraftOrder() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can repair the draft order.");
    const orderedTeams = getAssignedActiveTeams(teams);
    for (const [index, team] of orderedTeams.entries()) {
      const targetSlot = index + 1;
      if (team.draft_slot !== targetSlot) {
        await updateTeam(team.id, { draft_slot: targetSlot });
      }
    }
    setStatusMessage("Repaired the draft order.");
    await loadSession(selectedSessionId, false);
  }

  async function removeFromOrder(team: DraftTeam) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can remove teams from the draft order.");
    if (team.draft_slot === null) return;
    const removedSlot = team.draft_slot;
    await updateTeam(team.id, { draft_slot: null, active: false }, `${team.name} was removed from the draft order.`);
    for (const entry of teams.filter((item) => item.id !== team.id && item.draft_slot !== null && item.draft_slot > removedSlot)) {
      await updateTeam(entry.id, { draft_slot: (entry.draft_slot ?? 1) - 1 });
    }
    await loadSession(selectedSessionId, false);
  }

  async function moveTeam(team: DraftTeam, direction: "up" | "down") {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can reorder teams.");
    if (team.draft_slot === null) return;
    const target = direction === "up" ? team.draft_slot - 1 : team.draft_slot + 1;
    const swapTeam = assignedTeams.find((entry) => entry.draft_slot === target);
    if (!swapTeam) return;
    await updateTeam(team.id, { draft_slot: target });
    await updateTeam(swapTeam.id, { draft_slot: team.draft_slot });
    setStatusMessage(`Moved ${team.name} to pick ${target}.`);
    await loadSession(selectedSessionId, false);
  }

  async function clearDraftOrder() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can clear the draft order.");
    for (const team of assignedTeams) await updateTeam(team.id, { draft_slot: null, active: false });
    setStatusMessage("Cleared the draft order.");
    await loadSession(selectedSessionId, false);
  }

  async function savePlayerPool() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can save the player pool.");
    setBusy("Saving player pool...");
    const cleanedPlayers = sanitizePlayerNames(playerPoolDraft.split("\n"));
    const cleanedPlayerInput = cleanedPlayers.join("\n");
    setPlayerPoolDraft(cleanedPlayerInput);
    await updateSession({ player_input: cleanedPlayerInput }, `Saved ${cleanedPlayers.length} golfers in the player pool.`);
    setBusy("");
  }

  async function importFieldFromEspn() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can import the field.");
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before importing the field.");
    setBusy("Importing field...");
    try {
      const response = await fetch(`/api/espn-golf?action=field&eventId=${encodeURIComponent(currentSession.event_id)}`);
      const payload: EspnFieldResponse = await response.json();
      if (!payload.ok || !payload.players) throw new Error(payload.error);
      const cleanedPlayers = sanitizePlayerNames(payload.players);
      const playerInput = cleanedPlayers.join("\n");
      setPlayerPoolDraft(playerInput);
      await updateSession({ player_input: playerInput, event_name: payload.eventName ?? currentSession.event_name }, `Imported ${cleanedPlayers.length} golfers from ESPN after cleaning duplicates and invalid rows.`);
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not import the player field from ESPN.");
    }
    setBusy("");
  }

  async function pullLeaderboard() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can refresh leaderboard scoring.");
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before pulling leaderboard results.");
    setBusy("Pulling leaderboard...");
    try {
      const response = await fetch(`/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}`);
      const payload: EspnLeaderboardResponse = await response.json();
      if (!payload.ok || !payload.leaderboard) throw new Error(payload.error);
      await updateSession({ current_positions: payload.leaderboard, status: "scored" }, `Updated leaderboard results from ESPN for ${payload.eventName ?? currentSession.name}.`);
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not update leaderboard results from ESPN.");
    }
    setBusy("");
  }

  async function autoDraftRandomly() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can run the random draft.");
    if (!currentSession || !validDraftOrder || draftComplete) return;
    if (!availablePlayers.length) {
      setStatusMessage("There are no available golfers left to auto-draft.");
      return;
    }

    const remainingPicks = totalPicks - picks.length;
    if (availablePlayers.length < remainingPicks) {
      setStatusMessage("There are not enough available golfers to finish the draft.");
      return;
    }

    const randomPool = [...availablePlayers];
    for (let index = randomPool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [randomPool[index], randomPool[swapIndex]] = [randomPool[swapIndex], randomPool[index]];
    }

    setBusy("Random drafting...");
    const generatedPicks: Omit<DraftPick, "id" | "created_at">[] = [];
    for (let offset = 0; offset < remainingPicks; offset += 1) {
      const overallIndex = picks.length + offset;
      const roundNumber = Math.floor(overallIndex / assignedTeams.length) + 1;
      const roundIndex = overallIndex % assignedTeams.length;
      const team = roundNumber % 2 === 1 ? assignedTeams[roundIndex] : assignedTeams[assignedTeams.length - 1 - roundIndex];
      const playerName = randomPool[offset];
      generatedPicks.push({
        session_id: currentSession.id,
        team_id: team.id,
        player_name: playerName,
        player_key: normalizeName(playerName),
        pick_number: overallIndex + 1,
        round_number: roundNumber,
      });
    }

    const { error } = await supabase.from("draft_picks").insert(generatedPicks);
    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not complete the random draft.");
      return;
    }

    const completed = picks.length + generatedPicks.length >= totalPicks;
    await updateSession({ status: completed ? "draft_complete" : "drafting" }, `Randomly drafted ${generatedPicks.length} golfers.`);
    if (completed) setActiveRoomTab("results");
    setPlayerFilter("");
    setHighlightedPlayerIndex(0);
    setBusy("");
  }

  async function applyManualScores() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can apply manual scores.");
    if (!currentSession) return;
    setBusy("Applying manual scores...");
    const parsed = parseManualLeaderboard(manualLeaderboardDraft);
    if (!Object.keys(parsed).length) {
      setBusy("");
      setStatusMessage("Paste at least one leaderboard line before applying manual scores.");
      return;
    }
    await updateSession({ manual_leaderboard_input: manualLeaderboardDraft, current_positions: { ...(currentSession.current_positions ?? {}), ...parsed }, status: "scored" }, `Applied ${Object.keys(parsed).length} manual leaderboard entries.`);
    setBusy("");
  }

  async function replacePick(playerName: string) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can swap drafted golfers.");
    if (!editingPick) return;

    const replacementKey = normalizeName(playerName);
    if (draftedKeys.has(replacementKey)) {
      return setStatusMessage(`${playerName} has already been drafted.`);
    }

    setBusy("Replacing golfer...");
    const { error } = await supabase
      .from("draft_picks")
      .update({
        player_name: playerName,
        player_key: replacementKey,
      })
      .eq("id", editingPick.id);

    if (error) {
      console.error(error);
      setBusy("");
      return setStatusMessage("Could not replace that golfer.");
    }

    const oldPlayer = editingPick.playerName;
    const teamName = editingPick.teamName;
    setEditingPick(null);
    await updateSession(
      { status: "draft_complete" },
      `Replaced ${oldPlayer} with ${playerName} for ${teamName}.`
    );
    setBusy("");
  }

  async function makePick(playerName: string) {
    if (!currentSession || !validDraftOrder || !currentTeamOnClock || draftComplete) return;
    if (!canDraftCurrentPick) return setStatusMessage("You can only draft when your team is on the clock.");
    const playerKey = normalizeName(playerName);
    if (draftedKeys.has(playerKey)) return setStatusMessage(`${playerName} has already been drafted.`);
    setBusy("Saving pick...");
    const insertResult = await supabase.from("draft_picks").insert([{ session_id: currentSession.id, team_id: currentTeamOnClock.id, player_name: playerName, player_key: playerKey, pick_number: picks.length + 1, round_number: currentRound }]);
    if (insertResult.error) {
      console.error(insertResult.error);
      setBusy("");
      await loadSession(currentSession.id, false);
      return setStatusMessage("Could not save that pick. Refresh if someone else drafted at the same time.");
    }
    const isLastPick = picks.length + 1 >= totalPicks;
    setStatusMessage(`${currentTeamOnClock.name} drafted ${playerName}.`);
    await loadSessions();
    await loadSession(currentSession.id, false);
    if (isLastPick) {
      setActiveRoomTab("results");
    }
    setPlayerFilter("");
    setHighlightedPlayerIndex(0);
    setBusy("");
  }

  function handlePlayerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!availablePlayers.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedPlayerIndex((current) => Math.min(current + 1, availablePlayers.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedPlayerIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedPlayer = availablePlayers[highlightedPlayerIndex];
      if (!selectedPlayer) return;
      if (editingPick) {
        void replacePick(selectedPlayer);
      } else {
        void makePick(selectedPlayer);
      }
    }
  }

  async function undoLastPick() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can undo picks.");
    if (!currentSession || !picks.length) return setStatusMessage("There is no pick to undo.");
    setBusy("Undoing pick...");
    const lastPick = picks[picks.length - 1];
    const lastTeam = teams.find((team) => team.id === lastPick.team_id);
    const { error } = await supabase.from("draft_picks").delete().eq("id", lastPick.id);
    if (error) {
      console.error(error);
      setBusy("");
      return setStatusMessage("Could not undo the last pick.");
    }
    await updateSession({ status: "drafting" }, `Removed ${lastPick.player_name} from ${lastTeam?.name ?? "the draft board"}.`);
    setBusy("");
  }

  function beginSwap(pick: DraftPick, teamName: string) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can swap drafted golfers.");
      return;
    }
    setEditingPick({
      id: pick.id,
      teamName,
      playerName: pick.player_name,
    });
    setActiveRoomTab("draft");
    setStatusMessage(`Choose a replacement for ${pick.player_name} on ${teamName}.`);
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#ebe3d5_100%)] px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="w-full rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-[0_18px_45px_rgba(74,57,28,0.12)]">
            <h1 className="m-0 font-[Georgia] text-5xl">Rat Race Golf</h1>
            <p className="mb-0 mt-4 text-[#617061]">Loading your league access...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#ebe3d5_100%)] px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="grid w-full gap-5 rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-[0_18px_45px_rgba(74,57,28,0.12)]">
            <div>
              <h1 className="m-0 font-[Georgia] text-5xl">Rat Race Golf</h1>
              <p className="mb-0 mt-4 text-[#617061]">
                Create an account to draft for your team, follow live results, and review past tournaments. The first account created becomes the commissioner automatically.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_in" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_in")}>Sign In</button>
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_up" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_up")}>Create Account</button>
            </div>

            <div className="grid gap-3">
              {authMode === "sign_up" ? (
                <>
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} placeholder="Username" />
                  <select className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authTeamName} onChange={(event) => setAuthTeamName(event.target.value)}>
                    {DEFAULT_TEAM_NAMES.map((teamName) => <option key={teamName} value={teamName}>{teamName}</option>)}
                  </select>
                </>
              ) : null}
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email address" />
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Password" />
              <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={authMode === "sign_up" ? signUp : signIn}>
                {busy === "Creating account..." || busy === "Signing in..." ? busy : authMode === "sign_up" ? "Create Account" : "Sign In"}
              </button>
            </div>

            <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
              {busy || statusMessage}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#ebe3d5_100%)] px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto mb-5 flex max-w-[1880px] flex-wrap items-start justify-between gap-4">
          <h1 className="my-2 font-[Georgia] text-5xl leading-none md:text-7xl">Rat Race Golf</h1>
          <div className="grid justify-items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2 text-xs">
              <span className="rounded-full bg-white/80 px-3 py-1 text-[#1a5c3a]">{profile?.username}</span>
              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-[#1a5c3a]">{isCommissioner ? "Commissioner" : "Member"}</span>
              {profile?.team_name ? <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-[#6a5940]">{profile.team_name}</span> : null}
            </div>
            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-sm text-[#1a5c3a]" onClick={signOut}>Sign Out</button>
          </div>
        </div>

      <div className="mx-auto grid max-w-[1880px] gap-5 lg:grid-cols-[300px_1fr]">
        <section className="rounded-3xl border border-white/80 bg-white/80 p-5 shadow-[0_18px_45px_rgba(74,57,28,0.12)] lg:sticky lg:top-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="m-0 font-[Georgia] text-2xl">{canManageLeague ? "New Draft" : "League Hub"}</h2>
            <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{sessions.length} saved</span>
          </div>
            {canManageLeague ? (
              <div className="grid min-w-0 gap-3">
                <input className="w-full min-w-0 rounded-xl border border-black/15 bg-white px-3 py-3" value={newSessionName} onChange={(event) => setNewSessionName(event.target.value)} placeholder="Tournament name" />
                <select className="w-full min-w-0 rounded-xl border border-black/15 bg-white px-3 py-3" value={newSessionEventId} onChange={(event) => setNewSessionEventId(event.target.value)}>
                  <option value="">{events.length ? "Select an event" : "Loading events..."}</option>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                </select>
                <button className="w-full rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={createSession}>Create Live Session</button>
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                Open any tournament below to watch the live draft, make your pick when your team is on the clock, and review final leaderboards.
              </div>
            )}
            <div className="mt-5 grid gap-3">
              {!sessions.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No saved tournament sessions yet.</div> : sessions.map((session) => (
                <div key={session.id} className={`rounded-2xl border px-4 py-3 ${selectedSessionId === session.id ? "border-[#1a5c3a]/50 bg-[#e0eee4]" : "border-black/10 bg-white/80"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedSessionId(session.id)}>
                      <div className="flex justify-between gap-3"><strong>{session.name}</strong><span className="text-sm text-[#617061]">{statusLabel(session.status)}</span></div>
                    </button>
                    {canManageLeague ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1 text-xs text-[#9d4b2f]" onClick={() => deleteSession(session)}>Delete</button> : null}
                  </div>
                  <div className="text-sm text-[#617061]">{session.event_name || "No PGA event linked yet"}</div>
                  <div className="text-sm text-[#617061]">Saved {new Date(session.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
        </section>

        <section className="rounded-3xl border border-white/80 bg-white/80 p-5 shadow-[0_18px_45px_rgba(74,57,28,0.12)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="m-0 font-[Georgia] text-2xl">{currentSession ? currentSession.name : "Pick a session"}</h2>
              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{currentSession ? statusLabel(currentSession.status) : "No session selected"}</span>
            </div>

            {!currentSession ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">{canManageLeague ? "Create a tournament session on the left, then click it to open the shared draft room." : "Pick a saved tournament on the left to watch the draft, follow the leaderboard, and review past results."}</div> : (
              <div className="grid gap-5">
                  <div className="flex flex-wrap gap-3">
                    {canManageLeague ? <button className={`rounded-full px-4 py-2 ${activeRoomTab === "setup" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("setup")}>Setup</button> : null}
                    {canManageLeague ? <button className={`rounded-full px-4 py-2 ${activeRoomTab === "admin" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("admin")}>Admin</button> : null}
                  <button className={`rounded-full px-4 py-2 ${activeRoomTab === "draft" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("draft")}>Draft</button>
                  <button className={`rounded-full px-4 py-2 ${activeRoomTab === "results" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("results")}>Results</button>
                </div>

                {canManageLeague && activeRoomTab === "setup" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                    <h3 className="mb-4 mt-0 font-[Georgia] text-xl">League Setup</h3>
                    <div className="grid gap-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <h3 className="m-0 font-[Georgia] text-xl">Teams And Draft Order</h3>
                          <div className="flex items-center gap-2">
                            {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Order</button> : null}
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{assignedTeams.length} active</span>
                            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={clearDraftOrder}>Clear Order</button>
                          </div>
                        </div>
                        <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1.1fr)]">
                          <div className="grid min-h-[430px] gap-3 rounded-3xl border border-black/10 bg-white/75 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="m-0 font-[Georgia] text-lg">Available Teams</h4>
                              <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{unassignedTeams.length} left</span>
                            </div>
                            <div className="grid content-start gap-2 sm:grid-cols-2">
                              {!unassignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-4 text-sm text-[#617061]">Every team has been assigned to the draft order.</div> : unassignedTeams.map((team) => (
                                <div key={team.id} className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-black/10 bg-white/90 px-3 py-2.5">
                                  <span className="truncate font-medium">{team.name}</span>
                                  <button className="w-[74px] rounded-full bg-[#1a5c3a] px-3 py-1.5 text-sm text-white" onClick={() => assignNextPick(team)}>Assign</button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="grid min-h-[430px] gap-3 rounded-3xl border border-black/10 bg-white/75 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="m-0 font-[Georgia] text-lg">Draft Order</h4>
                              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{assignedTeams.length} assigned</span>
                            </div>
                            <div className="grid content-start gap-2">
                              {!assignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-4 text-sm text-[#617061]">Assign teams from the left to build the draft order.</div> : assignedTeams.map((team) => (
                                <div key={team.id} className="grid min-h-[78px] gap-2 rounded-2xl border border-black/10 bg-white/90 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <strong className="truncate">#{team.draft_slot} {team.name}</strong>
                                    <span className="text-xs text-[#617061]">Pick {team.draft_slot}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" disabled={team.draft_slot === 1} onClick={() => moveTeam(team, "up")}>Up</button>
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" disabled={team.draft_slot === assignedTeams.length} onClick={() => moveTeam(team, "down")}>Down</button>
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" onClick={() => removeFromOrder(team)}>Remove</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="my-1 h-px bg-black/10" />
                        <select className="rounded-xl border border-black/15 bg-white px-3 py-3" value={currentSession.event_id ?? ""} onChange={(event) => updateSession({ event_id: event.target.value || null, event_name: events.find((item) => item.id === event.target.value)?.name ?? null }, `Linked this session to ${events.find((item) => item.id === event.target.value)?.name ?? "the selected event"}.`)}>
                          <option value="">No event selected</option>
                          {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                        </select>
                    <div className="flex flex-wrap gap-3">
                      <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-3 text-[#1a5c3a]" onClick={importFieldFromEspn}>Import ESPN Field</button>
                      <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={savePlayerPool}>Save Player Pool</button>
                      </div>
                      <textarea className="min-h-72 rounded-xl border border-black/15 bg-white px-3 py-3 font-mono" value={playerPoolDraft} onChange={(event) => setPlayerPoolDraft(event.target.value)} placeholder="One golfer per line" />
                      <div className="my-1 h-px bg-black/10" />
                      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(420px,1.15fr)]">
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-xl">Scoring</h3>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#6a5940]">Best 3 of 4 count</span>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-3 text-[#1a5c3a]" onClick={pullLeaderboard}>Pull ESPN Leaderboard</button>
                            <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={applyManualScores}>Apply Manual Scores</button>
                          </div>
                          <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-3 py-2 text-sm text-[#617061]">
                            {busy || statusMessage}
                          </div>
                          <div className="text-sm text-[#617061]">Use this area to load or correct tournament positions before everyone watches the live standings.</div>
                        </div>
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <textarea className="min-h-52 rounded-xl border border-black/15 bg-white px-3 py-3 font-mono" value={manualLeaderboardDraft} onChange={(event) => setManualLeaderboardDraft(event.target.value)} placeholder={"Example:\n1 Scottie Scheffler\nT2 Rory McIlroy\nCUT Jordan Spieth"} />
                          <div className="text-sm text-[#617061]">Enter one player per line. Examples: `1 Scottie Scheffler`, `T2 Rory McIlroy`, `CUT Jordan Spieth`.</div>
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {canManageLeague && activeRoomTab === "admin" ? (
                <div className="grid gap-5">
                  <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="m-0 font-[Georgia] text-xl">League Admin</h3>
                      <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{teams.length} total teams</span>
                    </div>
                    <div className="grid gap-4">
                      <div className="flex flex-wrap gap-3 rounded-2xl border border-black/10 bg-white/75 p-3">
                        <input
                          className="min-w-[220px] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2"
                          value={newTeamName}
                          onChange={(event) => setNewTeamName(event.target.value)}
                          placeholder="Add a new team name"
                        />
                        <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={addTeam}>
                          Add Team
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {teams.map((team) => (
                          <div key={team.id} className="grid gap-2 rounded-2xl border border-black/10 bg-white/80 p-3 shadow-sm">
                            <input className="w-full rounded-xl border border-black/15 bg-white px-3 py-2" value={team.name} onChange={(event) => setTeams((current) => current.map((entry) => entry.id === team.id ? { ...entry, name: event.target.value } : entry))} onBlur={(event) => updateTeam(team.id, { name: event.target.value.trim() || team.name }, `Saved team name \"${event.target.value.trim() || team.name}\".`)} />
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-[#617061]">{team.draft_slot ? `Currently pick ${team.draft_slot}` : "Not in this week's draft"}</span>
                              {team.draft_slot === null ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1.5 text-sm text-[#9d4b2f]" onClick={() => deleteTeam(team)}>Delete</button> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                ) : null}

                {activeRoomTab === "draft" ? (
                  <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                    <h3 className="mb-4 mt-0 font-[Georgia] text-xl">Live Draft</h3>
                    <div className="grid gap-4">
                        <div className="grid gap-3 rounded-2xl bg-[#d9eadf] p-4 text-[#1a5c3a]">
                          <div className="font-semibold">
                            {editingPick
                              ? `Replacing ${editingPick.playerName} on ${editingPick.teamName}. Pick a replacement from the available golfer list.`
                              : !validDraftOrder
                                ? "The draft order needs to be repaired before you can make picks."
                                : draftComplete
                                  ? "The draft is complete. You can still score the results below."
                                    : `${currentTeamOnClock?.name ?? "Nobody"} is on the clock for pick ${picks.length + 1}.${canDraftCurrentPick ? " You're live for this pick." : currentUsersTeams.length ? ` Your team${currentUsersTeams.length > 1 ? "s are" : " is"} ${ownedTeamNames.join(", ")}.` : " Watch live until your team is up."}`}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-medium text-[#28523e]">
                            <span className="rounded-full bg-white/70 px-3 py-1">Event: {currentSession.event_name || "Not linked"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Round: {draftComplete ? "Complete" : String(currentRound || 0)}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Pick: {totalPicks ? `${Math.min(picks.length + 1, totalPicks)} / ${totalPicks}` : "0 / 0"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Clock: {draftComplete ? "Draft complete" : currentTeamOnClock?.name || "Set draft order"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Status: {statusLabel(currentSession.status)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Draft Order</button> : null}
                        {!draftComplete && validDraftOrder && canManageLeague ? <button className="rounded-full bg-[#f6d77a] px-4 py-2 font-semibold text-[#1f2a1d]" onClick={autoDraftRandomly}>Random Draft Remaining</button> : null}
                        {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={undoLastPick}>Undo Last Pick</button> : null}
                          {editingPick && canManageLeague ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={() => setEditingPick(null)}>Cancel Swap</button> : null}
                      </div>
                      <div className="grid items-start gap-5 xl:grid-cols-[minmax(290px,0.7fr)_minmax(760px,1.3fr)] 2xl:grid-cols-[minmax(310px,0.62fr)_minmax(980px,1.38fr)]">
                        <div className="grid content-start self-start gap-3">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-xl">Available Golfers</h3>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{availablePlayers.length} match{availablePlayers.length === 1 ? "" : "es"}</span>
                          </div>
                          {oddsSource ? <div className="text-xs text-[#617061]">Ordered by CBS Sports win odds, lowest odds first.</div> : null}
                          <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={playerFilter} onChange={(event) => { setPlayerFilter(event.target.value); setHighlightedPlayerIndex(0); }} onKeyDown={handlePlayerSearchKeyDown} placeholder="Search available golfers" />
                          <div className="grid max-h-[420px] content-start gap-2 overflow-auto rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-2 pr-2">
                            {!availablePlayers.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No available golfers match your search.</div> : availablePlayers.map((player) => (
                              <div key={player} className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 ${availablePlayers[highlightedPlayerIndex] === player ? "border-[#1a5c3a]/50 bg-[#e0eee4]" : "border-black/10 bg-white/90"}`} onMouseEnter={() => setHighlightedPlayerIndex(availablePlayers.indexOf(player))}>
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{player}</div>
                                  <div className="text-[11px] text-[#617061]">{oddsByPlayer[normalizeName(player)] ? `CBS odds +${oddsByPlayer[normalizeName(player)]}` : "Odds unavailable"}</div>
                                </div>
                                  <button className="rounded-full bg-[#1a5c3a] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={editingPick ? !canManageLeague : (!validDraftOrder || draftComplete || !canDraftCurrentPick)} onClick={() => editingPick ? replacePick(player) : makePick(player)}>{editingPick ? "Replace" : "Draft"}</button>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-3">
                          <h3 className="m-0 font-[Georgia] text-xl">Draft Board</h3>
                          <div className="grid gap-3 overflow-auto pr-2">
                            {!assignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Set the draft order before using the board.</div> : draftBoardRounds.map((round) => (
                              <div key={round.roundNumber} className="grid gap-2">
                                <div className="flex items-center gap-3">
                                  <div className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#6a5940]">Round {round.roundNumber}</div>
                                  <div className="text-sm text-[#617061]">{round.roundNumber % 2 === 1 ? "Left to right" : "Right to left"}</div>
                                </div>
                                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(round.cells.length, 1)}, minmax(136px, 1fr))` }}>
                                    {round.cells.map(({ team, pick, overallPick, isOnClock }) => (
                                      <div key={`${round.roundNumber}-${team.id}`} className={`grid min-h-[120px] content-start gap-2 rounded-2xl border p-3 ${isOnClock ? "border-[#1a5c3a]/60 bg-[#e0eee4]" : "border-black/10 bg-white/85"}`}>
                                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                                          <div className="min-w-0">
                                            <div className="text-[11px] uppercase tracking-[0.14em] text-[#617061]">Pick {overallPick}</div>
                                            <strong className="block text-sm leading-tight">{team.name}</strong>
                                          </div>
                                          {isOnClock ? <span className="rounded-full bg-[#1a5c3a] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">On Clock</span> : null}
                                        </div>
                                        {pick ? (
                                          <div className="grid gap-2">
                                            <div className="rounded-xl bg-[#f7f2e9] px-3 py-2 text-sm font-medium leading-tight">{pick.player_name}</div>
                                            {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1 text-xs text-[#1a5c3a]" onClick={() => beginSwap(pick, team.name)}>Swap</button> : null}
                                          </div>
                                        ) : (
                                          <div className={`rounded-xl px-3 py-2 text-sm leading-tight ${isOnClock ? "bg-white text-[#1a5c3a] font-semibold" : "bg-[#f7f2e9] text-[#617061]"}`}>
                                            {isOnClock ? "Drafting now" : "Waiting"}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                    </div>
                  </div>
                </div>
                ) : null}

                {activeRoomTab === "results" ? (
                <div className="grid gap-5">
                  <div className="rounded-[2rem] border border-black/10 bg-[radial-gradient(circle_at_top_left,#1f5d40_0%,#173c31_35%,#efe5d4_35.5%,#f7f2e9_100%)] p-4 text-white shadow-[0_18px_45px_rgba(74,57,28,0.15)]">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="grid gap-2">
                                <h3 className="m-0 font-[Georgia] text-3xl leading-tight">{currentSession.event_name || currentSession.name}</h3>
                                <div className="flex flex-wrap gap-2 text-xs font-medium text-white/85">
                                  <span className="rounded-full bg-white/12 px-3 py-1">{leaderboard.length} teams</span>
                                </div>
                              </div>
                                  <div className="grid w-full max-w-[260px] gap-2 justify-items-start">
                                    {canManageLeague ? <button className="rounded-full bg-[#f6d77a] px-4 py-2 text-sm font-semibold text-[#1f2a1d] shadow-[0_10px_20px_rgba(15,25,18,0.18)]" onClick={pullLeaderboard}>
                                  {busy === "Pulling leaderboard..." ? "Refreshing..." : "Refresh Leaderboard"}
                                    </button> : null}
                                <div className="w-full rounded-xl bg-[#f7f2e9] px-3 py-2 text-xs text-[#4c5b4d]">
                                  Last updated: {resultsUpdatedLabel}
                                </div>
                                <div className="w-full rounded-xl bg-[#f7f2e9] px-3 py-2 text-xs text-[#4c5b4d]">
                                  {busy === "Pulling leaderboard..." ? "Fetching latest ESPN positions..." : statusMessage}
                                </div>
                              </div>
                          </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          {!leaderboard.length ? <div className="rounded-3xl border border-white/15 bg-white/10 p-4 text-white/80">No active teams are ready to score yet.</div> : leaderboard.map((entry, index) => (
                          <div key={entry.team.id} className={`grid gap-2 rounded-[1.6rem] p-3 text-[#1f2a1d] shadow-[0_14px_30px_rgba(15,25,18,0.14)] ${index === 0 ? "bg-[#f6d77a]" : index === 1 ? "bg-[#e7ecef]" : index === 2 ? "bg-[#e1b18a]" : "bg-white/92"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-[#617061]">#{index + 1}</div>
                                <strong className="text-lg">{entry.team.name}</strong>
                              </div>
                              <div className="rounded-full bg-[#1a5c3a] px-3 py-1 text-sm font-semibold text-white">{entry.total} pts</div>
                            </div>
                            <div className="grid gap-1.5 text-sm">
                              {!entry.playerScores.length ? <div className="text-[#617061]">No drafted golfers yet.</div> : entry.playerScores.map((player) => (
                                <div key={player.id} className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl px-3 py-2 ${entry.countingKeys.has(player.id) ? "bg-[#e0eee4]" : "bg-[#f4efe6]"}`}>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium leading-tight">{player.player_name}</div>
                                    <div className="text-[11px] text-[#617061]">{player.position ? `P${player.position}` : "CUT / no finish"}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-semibold">{player.points}</div>
                                    <div className="text-[10px] uppercase tracking-[0.15em] text-[#617061]">{entry.countingKeys.has(player.id) ? "Counts" : "Bench"}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
                ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

