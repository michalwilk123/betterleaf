function matchScore(target: string, term: string): number | null {
  const exactIndex = target.indexOf(term);
  if (exactIndex !== -1) {
    const boundary = exactIndex === 0 || "/._- ".includes(target[exactIndex - 1]);
    return 40 + (boundary ? 5 : 0) - exactIndex * 0.2 - (target.length - term.length) * 0.05;
  }

  let previous = -1;
  let score = 0;
  for (const char of term) {
    const index = target.indexOf(char, previous + 1);
    if (index === -1) return null;
    score += 1;
    if (index === previous + 1) score += 3;
    if (index === 0 || "/._- ".includes(target[index - 1])) score += 2;
    previous = index;
  }
  return score - (target.length - term.length) * 0.05;
}

export function searchFiles<T extends { name: string }>(files: readonly T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [...files].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
  }

  const matches: Array<{ file: T; score: number }> = [];
  for (const file of files) {
    const path = file.name.toLowerCase();
    const name = path.slice(path.lastIndexOf("/") + 1);
    let score = -path.length * 0.02;
    for (const term of terms) {
      const nameScore = matchScore(name, term);
      const pathScore = matchScore(path, term);
      const best = Math.max(nameScore === null ? -Infinity : nameScore + 50, pathScore ?? -Infinity);
      if (best === -Infinity) {
        score = -Infinity;
        break;
      }
      score += best;
    }
    if (score !== -Infinity) matches.push({ file, score });
  }

  matches.sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name));
  return matches.slice(0, 50).map(({ file }) => file);
}
