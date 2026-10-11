/**
 * Coarse Nigerian regions. Precise coordinates and street addresses are swapped
 * for the nearest of these labels, so the model keeps useful context ("Lagos/Ikeja")
 * without ever seeing where a person actually is.
 */
export interface Region {
  label: string;
  lat: number;
  lon: number;
  /** Names that identify this region inside a written address. */
  aliases: string[];
}

export const REGIONS: Region[] = [
  { label: "Lagos/Ikeja", lat: 6.6018, lon: 3.3515, aliases: ["ikeja", "allen avenue", "maryland", "ogba", "alausa"] },
  { label: "Lagos/Victoria Island", lat: 6.4281, lon: 3.4219, aliases: ["victoria island", "v.i", "oniru"] },
  { label: "Lagos/Ikoyi", lat: 6.4549, lon: 3.4366, aliases: ["ikoyi", "obalende"] },
  { label: "Lagos/Lekki", lat: 6.4698, lon: 3.5852, aliases: ["lekki", "ajah", "chevron", "sangotedo", "ikota"] },
  { label: "Lagos/Surulere", lat: 6.5009, lon: 3.3581, aliases: ["surulere", "ojuelegba", "aguda"] },
  { label: "Lagos/Yaba", lat: 6.5095, lon: 3.3711, aliases: ["yaba", "akoka", "ebute metta", "sabo"] },
  { label: "Lagos/Apapa", lat: 6.4489, lon: 3.359, aliases: ["apapa", "ajegunle"] },
  { label: "Lagos/Ikorodu", lat: 6.6194, lon: 3.5105, aliases: ["ikorodu"] },
  { label: "Lagos/Festac", lat: 6.4667, lon: 3.2833, aliases: ["festac", "amuwo odofin", "satellite town"] },
  { label: "Lagos/Gbagada", lat: 6.5536, lon: 3.3885, aliases: ["gbagada", "shomolu", "bariga"] },
  { label: "Lagos/Mushin", lat: 6.5273, lon: 3.3414, aliases: ["mushin", "oshodi", "isolo", "ejigbo"] },
  { label: "Lagos/Lagos Island", lat: 6.4541, lon: 3.3947, aliases: ["lagos island", "marina", "idumota", "broad street"] },
  { label: "FCT/Garki", lat: 9.0333, lon: 7.4833, aliases: ["garki", "area 11", "area 1"] },
  { label: "FCT/Wuse", lat: 9.0765, lon: 7.4797, aliases: ["wuse"] },
  { label: "FCT/Maitama", lat: 9.0882, lon: 7.4934, aliases: ["maitama", "asokoro"] },
  { label: "FCT/Gwarinpa", lat: 9.1108, lon: 7.4165, aliases: ["gwarinpa", "jabi", "utako", "kubwa", "lugbe"] },
  { label: "Kano/Kano", lat: 12.0022, lon: 8.592, aliases: ["kano", "sabon gari kano", "nassarawa gra"] },
  { label: "Oyo/Ibadan", lat: 7.3775, lon: 3.947, aliases: ["ibadan", "bodija", "dugbe", "ring road"] },
  { label: "Rivers/Port Harcourt", lat: 4.8156, lon: 7.0498, aliases: ["port harcourt", "rumuokoro", "trans amadi", "d-line", "gra phase"] },
  { label: "Enugu/Enugu", lat: 6.4584, lon: 7.5464, aliases: ["enugu", "independence layout", "new haven"] },
  { label: "Kaduna/Kaduna", lat: 10.5105, lon: 7.4165, aliases: ["kaduna"] },
  { label: "Edo/Benin City", lat: 6.335, lon: 5.6037, aliases: ["benin city", "ugbowo"] },
  { label: "Plateau/Jos", lat: 9.8965, lon: 8.8583, aliases: ["jos"] },
  { label: "Ogun/Abeokuta", lat: 7.1475, lon: 3.3619, aliases: ["abeokuta"] },
  { label: "Ogun/Ota", lat: 6.6804, lon: 3.2356, aliases: ["ota", "sango ota", "agbara"] },
  { label: "Anambra/Onitsha", lat: 6.1413, lon: 6.8029, aliases: ["onitsha"] },
  { label: "Anambra/Awka", lat: 6.2104, lon: 7.0741, aliases: ["awka"] },
  { label: "Abia/Aba", lat: 5.1066, lon: 7.3667, aliases: ["aba"] },
  { label: "Cross River/Calabar", lat: 4.9757, lon: 8.3417, aliases: ["calabar"] },
  { label: "Akwa Ibom/Uyo", lat: 5.0377, lon: 7.9128, aliases: ["uyo"] },
  { label: "Imo/Owerri", lat: 5.484, lon: 7.0351, aliases: ["owerri"] },
  { label: "Delta/Warri", lat: 5.5167, lon: 5.75, aliases: ["warri", "effurun"] },
  { label: "Delta/Asaba", lat: 6.1985, lon: 6.7337, aliases: ["asaba"] },
  { label: "Kwara/Ilorin", lat: 8.4966, lon: 4.5421, aliases: ["ilorin"] },
  { label: "Borno/Maiduguri", lat: 11.8333, lon: 13.15, aliases: ["maiduguri"] },
  { label: "Sokoto/Sokoto", lat: 13.0059, lon: 5.2476, aliases: ["sokoto"] },
  { label: "Ondo/Akure", lat: 7.2571, lon: 5.2058, aliases: ["akure"] },
  { label: "Osun/Osogbo", lat: 7.7827, lon: 4.5418, aliases: ["osogbo", "oshogbo"] },
  { label: "Niger/Minna", lat: 9.6139, lon: 6.5569, aliases: ["minna"] },
  { label: "Bauchi/Bauchi", lat: 10.3158, lon: 9.8442, aliases: ["bauchi"] },
  { label: "Katsina/Katsina", lat: 12.9908, lon: 7.6018, aliases: ["katsina"] },
  { label: "Benue/Makurdi", lat: 7.7337, lon: 8.5214, aliases: ["makurdi"] },
];

const NIGERIA_BBOX = { minLat: 4.0, maxLat: 14.0, minLon: 2.6, maxLon: 14.8 };

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest coarse region for a coordinate; never more precise than a district. */
export function regionForPoint(lat: number, lon: number): string {
  const b = NIGERIA_BBOX;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return "Outside Nigeria";
  let best: Region | undefined;
  let bestKm = Infinity;
  for (const r of REGIONS) {
    const km = haversineKm(lat, lon, r.lat, r.lon);
    if (km < bestKm) {
      bestKm = km;
      best = r;
    }
  }
  if (!best || bestKm > 80) return "Nigeria";
  // Beyond city scale, drop the district and keep only the state.
  return bestKm > 25 ? best.label.split("/")[0]! : best.label;
}

/** Coarse region named inside a written address, if any. */
export function regionForAddress(text: string): string {
  const t = text.toLowerCase();
  for (const r of REGIONS) {
    if (r.aliases.some((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))) {
      return r.label;
    }
  }
  if (/\blagos\b/.test(t)) return "Lagos";
  if (/\babuja\b|\bfct\b/.test(t)) return "FCT";
  return "Nigeria";
}
