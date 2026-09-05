export function participantInitials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase("ru");
}

export function participantColor(identity: string, isLocal: boolean): string {
  if (isLocal) return "#a6aca4";
  const colors = ["#d4b5dd", "#b7c9af", "#b4c6d1", "#d9c4a4", "#c1bcd8"];
  let hash = 0;
  for (const character of identity) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return colors[hash % colors.length];
}

export function participantCountLabel(count: number): string {
  return `${count} ${count === 1 ? "участник" : count >= 2 && count <= 4 ? "участника" : "участников"}`;
}
