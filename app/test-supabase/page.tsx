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

export default function TestSupabasePage() {
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [loading, setLoading] = useState(false);

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

  async function addTestPick() {
    setLoading(true);

    const nextPickNumber = picks.length + 1;

    const { error } = await supabase.from('draft_picks').insert([
      {
        team: 'Team 1',
        player_name: `Test Player ${nextPickNumber}`,
        pick_number: nextPickNumber,
      },
    ]);

    if (error) {
      console.error('Error inserting pick:', error);
      alert('Insert failed. Check console.');
      setLoading(false);
      return;
    }

    setLoading(false);
  }

  useEffect(() => {
    loadPicks();

    const channel = supabase
      .channel('draft-picks-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_picks',
        },
        () => {
          loadPicks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Supabase Test Page</h1>

      <button
        onClick={addTestPick}
        disabled={loading}
        style={{
          padding: '10px 16px',
          marginBottom: '20px',
          cursor: 'pointer',
        }}
      >
        {loading ? 'Saving...' : 'Add Test Pick'}
      </button>

      <div>
        <h2>Draft Picks</h2>
        {picks.length === 0 ? (
          <p>No picks yet.</p>
        ) : (
          <ul>
            {picks.map((pick) => (
              <li key={pick.id}>
                Pick {pick.pick_number}: {pick.team} drafted {pick.player_name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}