export function participantInitials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase("ru");
}

export function participantColor(identity: string, isLocal: boolean): string {
  if (isLocal) return "light-dark(#a6aca4, #737a74)";
  const colors = ["#ff8069", "#86bbff", "#d9a3ff", "#74d6a2", "#ffbb5e", "#62d4e8", "#ff9fbd"];
  let hash = 0;
  for (const character of identity) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return colors[hash % colors.length];
}

export function participantCountLabel(count: number): string {
  return `${count} ${count === 1 ? "участник" : count >= 2 && count <= 4 ? "участника" : "участников"}`;
}
