'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type DraftPick = {
  id: number;
  team: string;
  player_name: string;
  pick_number: number;
  created_at: string;
};

type DraftState = {
  id: number;
  current_pick_number: number;
  current_team: string;
  is_draft_open: boolean;
};

export default function DraftRoomPage() {
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [team, setTeam] = useState('Team 1');
  const [playerName, setPlayerName] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadPicks() {
    const { data, error } = await supabase
      .from('draft_picks')
      .select('*')
      .order('pick_number', { ascending: true });

    if (error) {
      console.error('Error loading picks:', error);
      return;
    }

    setPicks(data || []);
  }
async function loadDraftState() {
  setStateLoading(true);

  const { data, error } = await supabase
    .from('draft_state')
    .select('*')
    .order('id', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error loading draft state:', error);
    setStateLoading(false);
    return;
  }

  if (!data || data.length === 0) {
    setDraftState(null);
    setStateLoading(false);
    return;
  }

  setDraftState(data[0]);
  setStateLoading(false);
}
  async function addPick() {
  if (!playerName.trim()) {
    alert('Enter a player name.');
    return;
  }

  if (!draftState) {
    alert('Draft state not loaded.');
    return;
  }

  if (!draftState.is_draft_open) {
    alert('Draft is currently closed.');
    return;
  }

  if (team !== draftState.current_team) {
    alert(`It is currently ${draftState.current_team}'s turn.`);
    return;
  }

  const cleanedPlayerName = playerName.trim();

  const alreadyDrafted = picks.some(
    (pick) => pick.player_name.toLowerCase() === cleanedPlayerName.toLowerCase()
  );

  if (alreadyDrafted) {
    alert('That player has already been drafted.');
    return;
  }

  setSaving(true);

  const nextPickNumber = picks.length + 1;

  const { error } = await supabase.from('draft_picks').insert([
    {
      team,
      player_name: cleanedPlayerName,
      pick_number: nextPickNumber,
    },
  ]);

  if (error) {
    console.error('Error inserting pick:', error);
    alert('Could not save pick.');
    setSaving(false);
    return;
  }

  setPlayerName('');
  setSaving(false);
}

  useEffect(() => {
    loadPicks();
    loadDraftState();

    const channel = supabase
      .channel('draft-room-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_picks',
        },
        () => {
          loadPicks();
          loadDraftState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{ padding: '24px', fontFamily: 'Arial, sans-serif', maxWidth: '900px' }}>
      <h1>PGA Fantasy Draft Room</h1>
      <div style={{ marginBottom: '20px', padding: '12px', border: '1px solid #444', borderRadius: '8px' }}>
  {stateLoading ? (
    <p>Loading draft state...</p>
  ) : draftState ? (
    <>
      <p><strong>Current Pick:</strong> {draftState.current_pick_number}</p>
      <p><strong>On the Clock:</strong> {draftState.current_team}</p>
      <p><strong>Draft Open:</strong> {draftState.is_draft_open ? 'Yes' : 'No'}</p>
    </>
  ) : (
    <p>No draft state found.</p>
  )}
</div>

      <div style={{ marginBottom: '24px', padding: '16px', border: '1px solid #444', borderRadius: '8px' }}>
        <h2>Make a Pick</h2>

        <div style={{ marginBottom: '12px' }}>
          <label>
            Team:
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              style={{ marginLeft: '10px', padding: '6px' }}
            >
              <option>Team 1</option>
              <option>Team 2</option>
              <option>Team 3</option>
              <option>Team 4</option>
              <option>Team 5</option>
              <option>Team 6</option>
              <option>Team 7</option>
              <option>Team 8</option>
              <option>Team 9</option>
              <option>Team 10</option>
              <option>Team 11</option>
              <option>Team 12</option>
            </select>
          </label>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label>
            Player Name:
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter golfer name"
              style={{ marginLeft: '10px', padding: '6px', width: '300px' }}
            />
          </label>
        </div>

        <button
          onClick={addPick}
          disabled={saving}
          style={{ padding: '10px 16px', cursor: 'pointer' }}
        >
          {saving ? 'Saving...' : 'Draft Player'}
        </button>
      </div>

      <div style={{ padding: '16px', border: '1px solid #444', borderRadius: '8px' }}>
        <h2>Live Draft Board</h2>

        {picks.length === 0 ? (
          <p>No picks yet.</p>
        ) : (
          <ol>
            {picks.map((pick) => (
              <li key={pick.id} style={{ marginBottom: '8px' }}>
                Pick {pick.pick_number}: <strong>{pick.team}</strong> drafted <strong>{pick.player_name}</strong>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}