export function snakeDraftPosition(pickCount: number, teamCount: number) {
  if (!Number.isInteger(pickCount) || pickCount < 0) throw new RangeError("pickCount must be a non-negative integer");
  if (!Number.isInteger(teamCount) || teamCount < 1) throw new RangeError("teamCount must be a positive integer");

  const pickNumber = pickCount + 1;
  const roundNumber = Math.floor(pickCount / teamCount) + 1;
  const indexWithinRound = pickCount % teamCount;
  const teamIndex = roundNumber % 2 === 1
    ? indexWithinRound
    : teamCount - indexWithinRound - 1;

  return { pickNumber, roundNumber, teamIndex };
}

export function draftStatusAfterPickCount(pickCount: number, teamCount: number, picksPerTeam = 4) {
  if (pickCount === 0 || teamCount === 0) return "setup";
  return pickCount >= teamCount * picksPerTeam ? "draft_complete" : "drafting";
}
