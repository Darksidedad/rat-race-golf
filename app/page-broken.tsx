// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Team = {
  name: string;
  picks: string[];
  draftSlot: number | null;
  active: boolean;
};

type EventOption = {
  id: string;
  name: string;
};

type SavedState = {
  playerInput: string;
  teams: Team[];
  activeTab: "draft" | "setup";
  manualLeaderboardInput: string;
  currentPositions: Record<string, number | null>;
  statusMessage: string;
  selectedEventId: string;
};

type SavedDraftSnapshot = {
  name: string;
  savedAt: string;
  state: SavedState;
};

type EspnEventsResponse = {
  ok: boolean;
  events?: EventOption[];
  error?: string;
};

type EspnFieldResponse = {
  ok: boolean;
  eventName?: string;
  players?: string[];
  source?: string;
  error?: string;
};

type EspnLeaderboardResponse = {
  ok: boolean;
  eventName?: string;
  leaderboard?: Record<string, number | null>;
  source?: string;
  error?: string;
};

const STORAGE_KEY = "pga-draft-state-v10";
const SAVED_DRAFTS_KEY = "pga-draft-saved-drafts-v1";
const ROUNDS = 4;

const DEFAULT_TEAM_NAMES = [
  "Ryan",
  "Morris",
  "Russ",
  "Swany",
  "Capps",
  "Seth",
  "Jay",
  "Teron",
  "Jesse",
  "Drew",
  "Jimmy",
  "Jones",
];

const DEFAULT_PLAYERS = `Scottie Scheffler
Rory McIlroy
Jon Rahm
Viktor Hovland
Xander Schauffele
Collin Morikawa
Patrick Cantlay
Brooks Koepka
Jordan Spieth
Justin Thomas`;

const DEFAULT_TEAMS: Team[] = DEFAULT_TEAM_NAMES.map((name) => ({
  name,
  picks: [],
  draftSlot: null,
  active: true,
}));

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pointsForPosition(pos: number | null) {
  if (pos === null || pos < 1) return 0;
  return Math.max(0, 51 - pos);
}

function parseManualLeaderboard(input: string): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(T?\d+|CUT|WD|DQ)\s+(.+)$/i);
    if (!match) continue;

    const rawPos = match[1].toUpperCase();
    const name = match[2].trim();

    if (rawPos === "CUT" || rawPos === "WD" || rawPos === "DQ") {
      result[normalizeName(name)] = null;
      continue;
    }

    const numeric = Number(rawPos.replace("T", ""));
    result[normalizeName(name)] = Number.isFinite(numeric) ? numeric : null;
  }

  return result;
}

function getActiveTeams(teams: Team[]) {
  return teams.filter((team) => team.active);
}

function getAssignedActiveTeams(teams: Team[]) {
  return teams
    .filter((team) => team.active && team.draftSlot !== null)
    .sort((a, b) => (a.draftSlot! - b.draftSlot!));
}

function getUnassignedActiveTeams(teams: Team[]) {
  return teams.filter((team) => team.active && team.draftSlot === null);
}

function hasValidDraftOrder(teams: Team[]) {
  const active = getActiveTeams(teams);
  const assigned = getAssignedActiveTeams(teams);

  if (active.length === 0) return false;
  if (assigned.length !== active.length) return false;

  const slots = assigned.map((t) => t.draftSlot);
  const unique = new Set(slots);

  if (unique.size !== slots.length) return false;

  for (let i = 1; i <= active.length; i++) {
    if (!unique.has(i)) return false;
  }

  return true;
}

function getDraftedCount(teams: Team[]) {
  return teams.reduce((sum, team) => sum + team.picks.length, 0);
}

function getTotalPicks(teams: Team[]) {
  return getActiveTeams(teams).length * ROUNDS;
}

function getCurrentRound(teams: Team[]) {
  const active = getAssignedActiveTeams(teams);
  if (active.length === 0) return 0;

  const draftedCount = getDraftedCount(teams);
  return Math.floor(draftedCount / active.length) + 1;
}

function getCurrentPickNumber(teams: Team[]) {
  return getDraftedCount(teams) + 1;
}

function getCurrentTeamDraftSlot(teams: Team[]) {
  const active = getAssignedActiveTeams(teams);
  const totalPicks = getTotalPicks(teams);
  const draftedCount = getDraftedCount(teams);

  if (active.length === 0) return null;
  if (draftedCount >= totalPicks) return null;

  const round = Math.floor(draftedCount / active.length) + 1;
  const pickInRound = draftedCount % active.length;

  if (round % 2 === 1) return active[pickInRound]?.draftSlot ?? null;
  return active[active.length - 1 - pickInRound]?.draftSlot ?? null;
}

export default function Page() {
  const [activeTab, setActiveTab] = useState<"draft" | "setup">("draft");
  const [playerInput, setPlayerInput] = useState(DEFAULT_PLAYERS);
  const [teams, setTeams] = useState<Team[]>(DEFAULT_TEAMS);

 async function loadDraftFromSupabase() {
  const { data, error } = await supabase
    .from("draft_picks")
    .select("*")
    .order("pick_number", { ascending: true });

  if (error) {
    console.error("Error loading draft:", error);
    return;
  }

  if (!data) return;

  setTeams((prevTeams) => {
    const updatedTeams = prevTeams.map((team) => ({
      ...team,
      picks: [],
    }));

    data.forEach((pick) => {
      const teamIndex = updatedTeams.findIndex((t) => t.name === pick.team);

      if (teamIndex !== -1) {
        updatedTeams[teamIndex].picks.push(pick.player_name);
      }
    });

    return updatedTeams;
  });
}
async function loadTeamsConfigFromSupabase() {
  const { data, error } = await supabase
    .from("draft_config")
    .select("teams_json")
    .eq("name", "main")
    .single();

  if (error) {
    console.error("Error loading teams config:", error);
    return;
  }

  if (!data?.teams_json) return;

  setTeams(data.teams_json as Team[]);
}
  const [filter, setFilter] = useState("");
  const [manualLeaderboardInput, setManualLeaderboardInput] = useState("");
  const [currentPositions, setCurrentPositions] = useState<Record<string, number | null>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingEspnField, setLoadingEspnField] = useState(false);
  const [loadingEspnLeaderboard, setLoadingEspnLeaderboard] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [savedDrafts, setSavedDrafts] = useState<SavedDraftSnapshot[]>([]);
  const [draftSaveName, setDraftSaveName] = useState("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  async function saveTeamsConfigToSupabase() {
  const { error } = await supabase
    .from("draft_config")
    .update({
      teams_json: teams,
    })
    .eq("name", "main");

  if (error) {
    console.error("Error saving teams config:", error);
    setStatusMessage("Failed to save shared draft setup.");
    return;
  }

  setStatusMessage("Shared draft setup saved.");
}

  useEffect(() => {
    loadTeamsConfigFromSupabase();
    loadDraftFromSupabase();
    const channel = supabase
  .channel("live-draft-picks")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "draft_picks",
    },
    () => {
      console.log("Realtime update received from Supabase");
  loadDraftFromSupabase();
    }
  )
  .subscribe((status) => {
  console.log("Realtime subscription status:", status);
});

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: SavedState = JSON.parse(raw);
        if (saved.playerInput) setPlayerInput(saved.playerInput);
        if (saved.activeTab) setActiveTab(saved.activeTab);
        if (saved.manualLeaderboardInput) setManualLeaderboardInput(saved.manualLeaderboardInput);
        if (saved.currentPositions) setCurrentPositions(saved.currentPositions);
        if (saved.statusMessage) setStatusMessage(saved.statusMessage);
        if (saved.selectedEventId) setSelectedEventId(saved.selectedEventId);
      }

      const savedDraftsRaw = localStorage.getItem(SAVED_DRAFTS_KEY);
      if (savedDraftsRaw) {
        const parsed: SavedDraftSnapshot[] = JSON.parse(savedDraftsRaw);
        setSavedDrafts(parsed);
      }
    } catch (err) {
      console.error("Failed to load saved draft", err);
    } finally {
      setLoaded(true);
    }
    return () => {
  supabase.removeChannel(channel);
};
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const stateToSave: SavedState = {
      playerInput,
      teams,
      activeTab,
      manualLeaderboardInput,
      currentPositions,
      statusMessage,
      selectedEventId,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (err) {
      console.error("Failed to save current state", err);
    }
  }, [
    playerInput,
    teams,
    activeTab,
    manualLeaderboardInput,
    currentPositions,
    statusMessage,
    selectedEventId,
    loaded,
  ]);

  useEffect(() => {
    if (!loaded) return;

    try {
      localStorage.setItem(SAVED_DRAFTS_KEY, JSON.stringify(savedDrafts));
    } catch (err) {
      console.error("Failed to save named drafts", err);
    }
  }, [savedDrafts, loaded]);

  useEffect(() => {
    loadEvents();
  }, []);

  const allPlayers = useMemo(() => {
    return playerInput
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
  }, [playerInput]);

  const draftedPlayers = useMemo(() => {
    const s = new Set<string>();
    teams.forEach((team) => team.picks.forEach((p) => s.add(p)));
    return s;
  }, [teams]);

  const availablePlayers = useMemo(() => {
    return allPlayers
      .filter((p) => !draftedPlayers.has(p))
      .filter((p) => p.toLowerCase().includes(filter.toLowerCase()));
  }, [allPlayers, draftedPlayers, filter]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filter, playerInput, teams]);

  const leaderboard = useMemo(() => {
    return teams
      .map((team) => {
        const players = team.picks.map((player) => {
          const pos = currentPositions[normalizeName(player)] ?? null;
          const points = pointsForPosition(pos);
          return { player, pos, points };
        });

        const total = players.reduce((sum, p) => sum + p.points, 0);

        return {
          name: team.name,
          total,
          players,
          active: team.active,
          draftSlot: team.draftSlot,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [teams, currentPositions]);

  const activeTeams = getActiveTeams(teams);
  const assignedActiveTeams = getAssignedActiveTeams(teams);
  const unassignedActiveTeams = getUnassignedActiveTeams(teams);
  const validDraftOrder = hasValidDraftOrder(teams);
  const draftedCount = getDraftedCount(teams);
  const totalPicks = getTotalPicks(teams);
  const currentRound = getCurrentRound(teams);
  const currentPick = getCurrentPickNumber(teams);
  const currentDraftSlot = validDraftOrder ? getCurrentTeamDraftSlot(teams) : null;
  const currentTeam = teams.find((t) => t.draftSlot === currentDraftSlot) ?? null;
  const draftComplete = draftedCount >= totalPicks || activeTeams.length === 0;

  function getCurrentState(): SavedState {
    return {
      playerInput,
      teams,
      activeTab,
      manualLeaderboardInput,
      currentPositions,
      statusMessage,
      selectedEventId,
    };
  }

  function getRandomAvailablePlayer() {
    if (availablePlayers.length === 0) return null;
    const index = Math.floor(Math.random() * availablePlayers.length);
    return availablePlayers[index];
  }

  function autoDraftCurrentTeam() {
    if (!validDraftOrder) {
      setStatusMessage("Finish assigning draft order before using Auto Draft.");
      return;
    }

    if (draftComplete) {
      setStatusMessage("Draft is already complete.");
      return;
    }

    const randomPlayer = getRandomAvailablePlayer();
    if (!randomPlayer) {
      setStatusMessage("No available players left to auto draft.");
      return;
    }

    draftPlayer(randomPlayer);
    setStatusMessage(`${randomPlayer} was auto drafted to ${currentTeam?.name ?? "the current team"}.`);
  }

  function autoDraftRemaining() {
    if (!validDraftOrder) {
      setStatusMessage("Finish assigning draft order before using Auto Draft.");
      return;
    }

    if (draftComplete) {
      setStatusMessage("Draft is already complete.");
      return;
    }

    let workingTeams = [...teams];
    let workingAvailable = [...availablePlayers];

    function localGetAssignedActiveTeams(localTeams: Team[]) {
      return localTeams
        .filter((team) => team.active && team.draftSlot !== null)
        .sort((a, b) => (a.draftSlot! - b.draftSlot!));
    }

    function localGetDraftedCount(localTeams: Team[]) {
      return localTeams.reduce((sum, team) => sum + team.picks.length, 0);
    }

    function localGetTotalPicks(localTeams: Team[]) {
      return localTeams.filter((team) => team.active).length * ROUNDS;
    }

    function localGetCurrentTeamDraftSlot(localTeams: Team[]) {
      const active = localGetAssignedActiveTeams(localTeams);
      const totalPicks = localGetTotalPicks(localTeams);
      const draftedCount = localGetDraftedCount(localTeams);

      if (active.length === 0) return null;
      if (draftedCount >= totalPicks) return null;

      const round = Math.floor(draftedCount / active.length) + 1;
      const pickInRound = draftedCount % active.length;

      if (round % 2 === 1) return active[pickInRound]?.draftSlot ?? null;
      return active[active.length - 1 - pickInRound]?.draftSlot ?? null;
    }

    while (
      localGetDraftedCount(workingTeams) < localGetTotalPicks(workingTeams) &&
      workingAvailable.length > 0
    ) {
      const currentSlot = localGetCurrentTeamDraftSlot(workingTeams);
      if (currentSlot === null) break;

      const randomIndex = Math.floor(Math.random() * workingAvailable.length);
      const randomPlayer = workingAvailable[randomIndex];

      workingTeams = workingTeams.map((team) => {
        if (team.draftSlot !== currentSlot) return team;
        if (!team.active) return team;
        if (team.picks.length >= ROUNDS) return team;
        return {
          ...team,
          picks: [...team.picks, randomPlayer],
        };
      });

      workingAvailable.splice(randomIndex, 1);
    }

    setTeams(workingTeams);
    setFilter("");
    setHighlightedIndex(0);
    setStatusMessage("Auto draft completed for all remaining picks.");

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function saveNamedDraft() {
    const trimmed = draftSaveName.trim();
    if (!trimmed) {
      setStatusMessage("Enter a name before saving the draft.");
      return;
    }

    const snapshot: SavedDraftSnapshot = {
      name: trimmed,
      savedAt: new Date().toISOString(),
      state: getCurrentState(),
    };

    setSavedDrafts((prev) => {
      const withoutSameName = prev.filter((d) => d.name !== trimmed);
      return [snapshot, ...withoutSameName];
    });

    setStatusMessage(`Saved draft as "${trimmed}".`);
    setDraftSaveName("");
  }

  function loadNamedDraft(name: string) {
    const found = savedDrafts.find((d) => d.name === name);
    if (!found) return;

    const s = found.state;
    setPlayerInput(s.playerInput);
    setTeams(s.teams);
    setActiveTab(s.activeTab);
    setManualLeaderboardInput(s.manualLeaderboardInput);
    setCurrentPositions(s.currentPositions);
    setStatusMessage(`Loaded saved draft "${found.name}".`);
    setSelectedEventId(s.selectedEventId);
    setFilter("");
    setHighlightedIndex(0);

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function deleteNamedDraft(name: string) {
    const ok = window.confirm(`Delete saved draft "${name}"?`);
    if (!ok) return;

    setSavedDrafts((prev) => prev.filter((d) => d.name !== name));
    setStatusMessage(`Deleted saved draft "${name}".`);
  }

  function draftPlayer(player: string) {
    if (!validDraftOrder) {
      setStatusMessage("Finish assigning draft order before drafting.");
      return;
    }
    if (draftComplete || currentDraftSlot === null) return;
    // Save pick to Supabase (shared draft)
(async () => {
  try {
    const currentTeam = getAssignedActiveTeams(teams)
      .find((t) => t.draftSlot === currentDraftSlot);

    if (!currentTeam) return;

    const nextPickNumber = getDraftedCount(teams) + 1;

    const { error } = await supabase.from("draft_picks").insert([
      {
        team: currentTeam.name,
        player_name: player,
        pick_number: nextPickNumber,
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
    }
  } catch (err) {
    console.error("Supabase error:", err);
  }
})();

    setTeams((prev) =>
      prev.map((team) => {
        if (team.draftSlot !== currentDraftSlot) return team;
        if (!team.active) return team;
        if (team.picks.length >= ROUNDS) return team;
        return { ...team, picks: [...team.picks, player] };
      })
    );

    setFilter("");
    setHighlightedIndex(0);

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function undoLastPick() {
    const ordered = getAssignedActiveTeams(teams);
    const draftedCountNow = getDraftedCount(teams);

    if (draftedCountNow === 0 || ordered.length === 0) return;

    const lastPickOverall = draftedCountNow - 1;
    const lastRound = Math.floor(lastPickOverall / ordered.length) + 1;
    const pickInRound = lastPickOverall % ordered.length;

    let lastDraftSlot: number | null = null;

    if (lastRound % 2 === 1) {
      lastDraftSlot = ordered[pickInRound]?.draftSlot ?? null;
    } else {
      lastDraftSlot = ordered[ordered.length - 1 - pickInRound]?.draftSlot ?? null;
    }

    if (lastDraftSlot === null) return;

    setTeams((prev) =>
      prev.map((team) => {
        if (team.draftSlot !== lastDraftSlot) return team;
        return { ...team, picks: team.picks.slice(0, -1) };
      })
    );

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function removePickFromTeam(teamName: string, playerName: string) {
    setTeams((prev) =>
      prev.map((team) => {
        if (team.name !== teamName) return team;
        return {
          ...team,
          picks: team.picks.filter((p) => p !== playerName),
        };
      })
    );

    setStatusMessage(`${playerName} was removed from ${teamName}.`);
    setFilter("");
    setHighlightedIndex(0);

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }

  function updateTeamName(teamIndex: number, name: string) {
    setTeams((prev) =>
      prev.map((team, idx) => (idx === teamIndex ? { ...team, name } : team))
    );
  }

  function toggleTeamActive(teamIndex: number) {
    setTeams((prev) =>
      prev.map((team, idx) => {
        if (idx !== teamIndex) return team;
        const newActive = !team.active;
        return {
          ...team,
          active: newActive,
          picks: newActive ? team.picks : [],
          draftSlot: newActive ? team.draftSlot : null,
        };
      })
    );
  }

  function clearDraftOrder() {
    setTeams((prev) =>
      prev.map((team) => ({
        ...team,
        draftSlot: null,
      }))
    );
    setStatusMessage("Draft order cleared.");
  }

  function assignTeamToNextPick(teamName: string) {
    const team = teams.find((t) => t.name === teamName && t.active);
    if (!team) return;
    if (team.draftSlot !== null) return;

    const nextPick = assignedActiveTeams.length + 1;

    setTeams((prev) =>
      prev.map((t) =>
        t.name === teamName ? { ...t, draftSlot: nextPick } : t
      )
    );
  }

  function removeTeamFromDraftOrder(teamName: string) {
    const removed = teams.find((t) => t.name === teamName);
    if (!removed || removed.draftSlot === null) return;

    const removedSlot = removed.draftSlot;

    setTeams((prev) =>
      prev.map((team) => {
        if (team.name === teamName) return { ...team, draftSlot: null };
        if (team.draftSlot !== null && team.draftSlot > removedSlot) {
          return { ...team, draftSlot: team.draftSlot - 1 };
        }
        return team;
      })
    );
  }

  function moveAssignedTeam(teamName: string, direction: "up" | "down") {
    const team = assignedActiveTeams.find((t) => t.name === teamName);
    if (!team || team.draftSlot === null) return;

    const current = team.draftSlot;
    const target = direction === "up" ? current - 1 : current + 1;

    if (target < 1 || target > assignedActiveTeams.length) return;

    setTeams((prev) =>
      prev.map((t) => {
        if (t.name === teamName) return { ...t, draftSlot: target };
        if (t.draftSlot === target) return { ...t, draftSlot: current };
        return t;
      })
    );
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (availablePlayers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < availablePlayers.length - 1 ? prev + 1 : prev
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const player = availablePlayers[highlightedIndex];
      if (player) draftPlayer(player);
    }
  }

  function resetDraft() {
    const ok = window.confirm("Are you sure you want to reset the entire draft?");
    if (!ok) return;

    setPlayerInput(DEFAULT_PLAYERS);
    setTeams(DEFAULT_TEAMS);
    setFilter("");
    setManualLeaderboardInput("");
    setCurrentPositions({});
    setStatusMessage("");
    setActiveTab("draft");
    setSelectedEventId("");
    setDraftSaveName("");

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear saved draft", err);
    }
  }

  function applyManualLeaderboard() {
    const parsed = parseManualLeaderboard(manualLeaderboardInput);
    setCurrentPositions((prev) => ({ ...prev, ...parsed }));
    setStatusMessage(`Applied ${Object.keys(parsed).length} manual leaderboard entries.`);
  }

  async function loadEvents() {
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/espn-golf?action=events", { cache: "no-store" });
      const data: EspnEventsResponse = await res.json();

      if (!data.ok || !data.events?.length) {
        setStatusMessage(data.error || "Could not load ESPN events.");
        return;
      }

      setEvents(data.events);

      if (!selectedEventId && data.events[0]?.id) {
        setSelectedEventId(data.events[0].id);
      }
    } catch (err) {
      console.error(err);
      setStatusMessage("Could not load ESPN events.");
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadFieldFromEspn() {
    setLoadingEspnField(true);
    try {
      const url = selectedEventId
        ? `/api/espn-golf?action=field&eventId=${encodeURIComponent(selectedEventId)}`
        : "/api/espn-golf?action=field";

      const res = await fetch(url, { cache: "no-store" });
      const data: EspnFieldResponse = await res.json();

      if (!data.ok || !data.players?.length) {
        setStatusMessage(data.error || "Could not load field from ESPN. Manual field is still available.");
        return;
      }

      setPlayerInput(data.players.join("\n"));
      setStatusMessage(
        `Loaded ${data.players.length} players from ESPN${data.eventName ? ` for ${data.eventName}` : ""}.`
      );
    } catch (err) {
      console.error(err);
      setStatusMessage("Could not load field from ESPN. Manual field is still available.");
    } finally {
      setLoadingEspnField(false);
    }
  }

  async function updateLeaderboardFromEspn() {
    setLoadingEspnLeaderboard(true);
    try {
      const url = selectedEventId
        ? `/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(selectedEventId)}`
        : "/api/espn-golf?action=leaderboard";

      const res = await fetch(url, { cache: "no-store" });
      const data: EspnLeaderboardResponse = await res.json();

      if (!data.ok || !data.leaderboard) {
        setStatusMessage(
          data.error || "Could not update from ESPN. Use the manual leaderboard box in Setup."
        );
        return;
      }

      setCurrentPositions((prev) => ({ ...prev, ...data.leaderboard! }));
      setStatusMessage(
        `Updated leaderboard from ESPN${data.eventName ? ` for ${data.eventName}` : ""}.`
      );
    } catch (err) {
      console.error(err);
      setStatusMessage("Could not update from ESPN. Use the manual leaderboard box in Setup.");
    } finally {
      setLoadingEspnLeaderboard(false);
    }
  }

  if (!loaded) {
    return <div style={{ padding: 20, color: "#fff", background: "#111", minHeight: "100vh" }}>Loading saved draft...</div>;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f1115",
        color: "#f5f7fb",
        padding: 20,
        fontFamily: "system-ui, Arial",
      }}
    >
      <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, marginBottom: 6 }}>PGA Fantasy Draft</h1>
        <div style={{ marginBottom: 12 }}>
  <button
    onClick={saveTeamsConfigToSupabase}
    style={{
      padding: "8px 12px",
      borderRadius: 6,
      border: "1px solid #3a4658",
      background: "#182231",
      color: "#f5f7fb",
      cursor: "pointer",
    }}
  >
    Save Shared Draft Setup
  </button>
</div>
        <p style={{ marginTop: 0, color: "#a7b0c0" }}>
          auto draft • edit picks • save/load named drafts
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <button onClick={() => setActiveTab("draft")} style={tabButton(activeTab === "draft")}>
            Draft Room
          </button>
          <button onClick={() => setActiveTab("setup")} style={tabButton(activeTab === "setup")}>
            Setup
          </button>
        </div>

        {statusMessage && (
          <div
            style={{
              background: "#1b2230",
              border: "1px solid #2b3240",
              borderRadius: 10,
              padding: 12,
              marginBottom: 16,
              color: "#f5f7fb",
            }}
          >
            {statusMessage}
          </div>
        )}

        {activeTab === "setup" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Panel title="Tournament Field">
                <p style={helperText}>
                  Choose an event, then load the field from ESPN. Manual field stays as backup.
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    style={darkInputStyle(280)}
                  >
                    <option value="">Select event</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>

                  <button onClick={loadEvents} style={darkButton} disabled={loadingEvents}>
                    {loadingEvents ? "Refreshing Events..." : "Refresh Events"}
                  </button>

                  <button onClick={loadFieldFromEspn} style={darkButton} disabled={loadingEspnField}>
                    {loadingEspnField ? "Loading Field..." : "Load Field"}
                  </button>

                  <button onClick={resetDraft} style={darkButton}>
                    Reset Draft
                  </button>
                </div>

                <textarea
                  value={playerInput}
                  onChange={(e) => setPlayerInput(e.target.value)}
                  rows={12}
                  style={darkTextareaStyle}
                />

                <div style={{ marginTop: 10, color: "#a7b0c0" }}>
                  Total players: <strong style={{ color: "#f5f7fb" }}>{allPlayers.length}</strong>
                </div>
              </Panel>

              <Panel title="Manual Leaderboard Paste">
                <p style={helperText}>
                  Paste lines like:
                  <br />
                  <code style={{ color: "#d7deea" }}>1 Scottie Scheffler</code>
                  <br />
                  <code style={{ color: "#d7deea" }}>T2 Rory McIlroy</code>
                  <br />
                  <code style={{ color: "#d7deea" }}>CUT Jordan Spieth</code>
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    onClick={updateLeaderboardFromEspn}
                    style={darkButton}
                    disabled={loadingEspnLeaderboard}
                  >
                    {loadingEspnLeaderboard ? "Updating..." : "Update Leaderboard"}
                  </button>
                  <button onClick={applyManualLeaderboard} style={darkButton}>
                    Apply Manual Paste
                  </button>
                </div>

                <textarea
                  value={manualLeaderboardInput}
                  onChange={(e) => setManualLeaderboardInput(e.target.value)}
                  rows={12}
                  style={darkTextareaStyle}
                />
              </Panel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Panel title="Draft Setup">
                <p style={helperText}>
                  Step 1: check who is drafting. Step 2: assign teams into Pick 1, Pick 2, Pick 3, etc.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <h3 style={sectionTitle}>Teams</h3>

                    <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                      {teams.map((team, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: "#1f2430",
                            border: "1px solid #2b3240",
                            borderRadius: 10,
                            padding: 10,
                            opacity: team.active ? 1 : 0.6,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ fontWeight: 700 }}>{team.name}</div>

                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={team.active}
                                onChange={() => toggleTeamActive(idx)}
                              />
                              {team.active ? "Drafting" : "Sit Out"}
                            </label>
                          </div>

                          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ color: "#a7b0c0", fontSize: 12 }}>
                              {team.draftSlot ? `Pick ${team.draftSlot}` : "Not assigned"}
                            </div>

                            {team.active && team.draftSlot === null && (
                              <button
                                onClick={() => assignTeamToNextPick(team.name)}
                                style={smallButton}
                              >
                                Assign to Next Pick
                              </button>
                            )}

                            {team.active && team.draftSlot !== null && (
                              <button
                                onClick={() => removeTeamFromDraftOrder(team.name)}
                                style={smallButton}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={sectionTitle}>Draft Order</h3>
                      <button onClick={clearDraftOrder} style={darkButton}>
                        Clear Order
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                      {Array.from({ length: activeTeams.length }, (_, i) => i + 1).map((pick) => {
                        const assignedTeam =
                          teams.find((team) => team.active && team.draftSlot === pick) ?? null;

                        return (
                          <div
                            key={pick}
                            style={{
                              background: "#121722",
                              border: "1px solid #2b3240",
                              borderRadius: 10,
                              padding: 10,
                              minHeight: 58,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                              <div>
                                <div style={{ color: "#a7b0c0", fontSize: 12 }}>Pick {pick}</div>
                                <div style={{ fontWeight: 700, marginTop: 2 }}>
                                  {assignedTeam ? assignedTeam.name : "Empty"}
                                </div>
                              </div>

                              {assignedTeam && (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    onClick={() => moveAssignedTeam(assignedTeam.name, "up")}
                                    style={smallButton}
                                    disabled={pick === 1}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => moveAssignedTeam(assignedTeam.name, "down")}
                                    style={smallButton}
                                    disabled={pick === activeTeams.length}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() => removeTeamFromDraftOrder(assignedTeam.name)}
                                    style={smallButton}
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {!validDraftOrder && (
                      <div style={{ marginTop: 12, color: "#ffcf8b" }}>
                        Assign every active team to a pick before starting the draft.
                      </div>
                    )}

                    {unassignedActiveTeams.length > 0 && (
                      <div style={{ marginTop: 12, color: "#a7b0c0" }}>
                        Unassigned: {unassignedActiveTeams.map((t) => t.name).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel title="Save / Load Drafts">
                <p style={helperText}>
                  Save a completed draft, or even a work-in-progress draft, and load it again later on this same browser.
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <input
                    value={draftSaveName}
                    onChange={(e) => setDraftSaveName(e.target.value)}
                    placeholder="Draft name (example: Players 2026)"
                    style={{ ...darkInputStyle(260), flex: 1 }}
                  />
                  <button onClick={saveNamedDraft} style={darkButton}>
                    Save Draft
                  </button>
                </div>

                <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                  {savedDrafts.length === 0 ? (
                    <div style={{ color: "#a7b0c0" }}>No saved drafts yet.</div>
                  ) : (
                    savedDrafts.map((draft) => (
                      <div
                        key={draft.name}
                        style={{
                          background: "#1f2430",
                          border: "1px solid #2b3240",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{draft.name}</div>
                        <div style={{ color: "#a7b0c0", fontSize: 12, marginTop: 4 }}>
                          Saved: {new Date(draft.savedAt).toLocaleString()}
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => loadNamedDraft(draft.name)} style={smallButton}>
                            Load
                          </button>
                          <button onClick={() => deleteNamedDraft(draft.name)} style={smallButton}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatusBox label="Round" value={draftComplete ? "Complete" : String(currentRound)} />
              <StatusBox label="Pick" value={`${draftComplete ? totalPicks : currentPick} / ${totalPicks}`} />
              <StatusBox label="On the Clock" value={draftComplete ? "Draft Complete" : currentTeam?.name ?? "Assign Draft Order"} />
              <StatusBox label="Active Teams" value={`${activeTeams.length}`} />
              <StatusBox label="Drafted" value={`${draftedCount} / ${totalPicks}`} />
              <div
                style={{
                  background: "#1f2430",
                  border: "1px solid #2b3240",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button onClick={undoLastPick} style={darkButton}>
                  Undo Last Pick
                </button>
                <button
                  onClick={autoDraftCurrentTeam}
                  style={darkButton}
                  disabled={draftComplete || !validDraftOrder}
                >
                  Auto Draft Current Team
                </button>
                <button
                  onClick={autoDraftRemaining}
                  style={darkButton}
                  disabled={draftComplete || !validDraftOrder}
                >
                  Auto Draft Remaining
                </button>
                <button
                  onClick={updateLeaderboardFromEspn}
                  style={darkButton}
                  disabled={loadingEspnLeaderboard}
                >
                  {loadingEspnLeaderboard ? "Updating..." : "Update Leaderboard"}
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.2fr 1.2fr", gap: 16 }}>
              <Panel title="Available Players">
                <input
                  ref={searchInputRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Type player name… use ↑ ↓ and Enter"
                  style={{ ...darkInputStyle(), marginBottom: 12, width: "100%" }}
                />

                <div
                  style={{
                    maxHeight: 650,
                    overflow: "auto",
                    border: "1px solid #2b3240",
                    borderRadius: 10,
                    background: "#121722",
                  }}
                >
                  {availablePlayers.length === 0 ? (
                    <div style={{ padding: 12, color: "#a7b0c0" }}>
                      No available players match your search.
                    </div>
                  ) : (
                    availablePlayers.map((player, index) => (
                      <div
                        key={player}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 12px",
                          borderBottom: "1px solid #2b3240",
                          background: index === highlightedIndex ? "#252d3b" : "transparent",
                        }}
                      >
                        <div>{player}</div>
                        <button
                          onClick={() => draftPlayer(player)}
                          disabled={draftComplete || !validDraftOrder}
                          style={{
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid #3b4558",
                            background: draftComplete || !validDraftOrder ? "#4d5563" : "#2d3647",
                            color: "#f5f7fb",
                            cursor: draftComplete || !validDraftOrder ? "not-allowed" : "pointer",
                          }}
                        >
                          Draft
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </Panel>

              <Panel title="Teams">
                <div style={{ maxHeight: 650, overflow: "auto", paddingRight: 4 }}>
                  {assignedActiveTeams.map((team) => {
                    const isCurrent = currentTeam?.draftSlot === team.draftSlot && !draftComplete;

                    return (
                      <div
                        key={team.name}
                        style={{
                          background: isCurrent ? "#252d3b" : "#1f2430",
                          border: isCurrent ? "2px solid #5d6b85" : "1px solid #2b3240",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={{ fontWeight: 700 }}>
                            #{team.draftSlot} {team.name}
                          </div>
                          <div style={{ color: "#a7b0c0" }}>
                            {team.picks.length}/{ROUNDS}
                          </div>
                        </div>

                        {team.picks.length === 0 ? (
                          <div style={{ color: "#a7b0c0" }}>No picks yet.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {team.picks.map((player) => {
                              const pos = currentPositions[normalizeName(player)] ?? null;
                              const points = pointsForPosition(pos);

                              return (
                                <div
                                  key={player}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    alignItems: "center",
                                  }}
                                >
                                  <div>{player}</div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ color: "#a7b0c0", minWidth: 120, textAlign: "right" }}>
                                      {pos ? `P${pos}` : "-"} • {points} pts
                                    </div>

                                    <button
                                      onClick={() => removePickFromTeam(team.name, player)}
                                      style={smallButton}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Custom Leaderboard">
                <div
                  style={{
                    border: "1px solid #2b3240",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "#121722",
                  }}
                >
                  {leaderboard.map((row, i) => (
                    <div
                      key={row.name + i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "12px 14px",
                        borderBottom: "1px solid #2b3240",
                        background: i === 0 ? "#252d3b" : "#1a202c",
                        opacity: row.active ? 1 : 0.55,
                      }}
                    >
                      <div>
                        <strong>{i + 1}.</strong> {row.name}
                        {!row.active ? " (Sit Out)" : ""}
                      </div>
                      <div style={{ fontWeight: 700 }}>{row.total} pts</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#171a21",
        border: "1px solid #2b3240",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

function StatusBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#1f2430",
        border: "1px solid #2b3240",
        borderRadius: 12,
        padding: 12,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "#a7b0c0", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#f5f7fb" }}>{value}</div>
    </div>
  );
}

function tabButton(active: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #2b3240",
    background: active ? "#2d3647" : "#1f2430",
    color: "#f5f7fb",
    cursor: "pointer",
  };
}

function darkInputStyle(minWidth?: number): React.CSSProperties {
  return {
    padding: 10,
    borderRadius: 8,
    border: "1px solid #2b3240",
    background: "#0f131b",
    color: "#f5f7fb",
    minWidth,
  };
}

const darkTextareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid #2b3240",
  background: "#0f131b",
  color: "#f5f7fb",
};

const darkButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #3b4558",
  background: "#2d3647",
  color: "#f5f7fb",
  cursor: "pointer",
};

const smallButton: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #3b4558",
  background: "#2d3647",
  color: "#f5f7fb",
  cursor: "pointer",
};

const helperText: React.CSSProperties = {
  color: "#a7b0c0",
  fontSize: 14,
  marginTop: 0,
  marginBottom: 12,
};

const sectionTitle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 10,
};
