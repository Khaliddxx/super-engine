import tzlookup from "tz-lookup";

export function timezoneFor(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

export function isWithinSendWindow(
  timezone: string | null | undefined,
  startHour = 9,
  endHour = 17,
): boolean {
  const tz = timezone || "UTC";
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    if (weekday === "Sat" || weekday === "Sun") return false;
    return hour >= startHour && hour < endHour;
  } catch {
    return true; // default permissive
  }
}
