// lib/dataLayer.ts
// Lokal demo-datalayer til Annisse Kattepension (web)
//
// Gemmer data i localStorage pr. kennel-id:
// - Bookinger (inkl. forespørgsler fra ejer-UI og interne bookinger)
// - Aktive ophold (check-ins / check-outs)
// - Bure (cages)
// - Kennel-profil
//
// Alt er “rigtige” bookinger/ophold, så kapacitet & indtjening kan regnes ud
// ud fra bookinger + checkins.

const STORAGE_PREFIX = "annisse_";
const BOOKING_KEY = STORAGE_PREFIX + "bookings_v2";
const CHECKIN_KEY = STORAGE_PREFIX + "checkins_v2";
const CAGE_KEY = STORAGE_PREFIX + "cages_v1";
const PROFILE_KEY = STORAGE_PREFIX + "profile_v1";

// Fast kennel-id (kan deles mellem web & apps)
export const KENNEL_ID = "annisse-001";

// Fast daglig kapacitet – Annisse har 6 bure
const FIXED_DAILY_CAPACITY = 6;

/* ------------------------------------------------------------------ */
/*                               Typer                                 */
/* ------------------------------------------------------------------ */

export type BookingStatus =
  | "pending" // ny booking / forespørgsel
  | "precheck" // accepteret – klar til ankomst
  | "converted" // lavet om til ophold (checkin)
  | "cancelled"
  | "archived"
  | "checked_in"
  | "checked_out"
  | string;

export type BookingSource = "owner" | "internal" | "other";

export interface BookingRecord {
  id: string;
  kennelId: string;
  status: BookingStatus;
  createdAt: string;
  source?: BookingSource;

  // Datoer som ISO "YYYY-MM-DD"
  checkIn: string;
  checkOut: string;

  // Basis felter
  petName?: string;
  petNames?: string;
  catCount?: number;
  roomCount?: number;

  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;

  note?: string;

  // Ekstra fra ejer-formularen
  indoorPet?: "inde" | "ude";
  food?: string;
  medicine?: string;
  allowSocialMedia?: boolean;

  [key: string]: any;
}

export interface CheckinRecord extends BookingRecord {
  // Opholdet er nu aktivt
  status: "checked_in" | "checked_out" | string;
  cageId?: string | null;
}

export interface KennelCage {
  id: string;
  kennelId: string;
  name: string;
  size?: string;
  location?: string;
  note?: string;
}

export interface KennelProfile {
  id: string;
  name: string;
  tagline?: string;
  nightlyRate?: number; // pris pr. nat
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;

  // Tekster til hjemmesiden
  shortDescription?: string; // forsiden / intro
  sellingPoints?: string; // punkter – fx én pr. linje
  practicalInfo?: string; // praktiske punkter – én pr. linje
  conditionsText?: string; // hele teksten til siden "Betingelser"
}

// Payload fra ejerens bookingformular på forsiden
export type OwnerBookingRequestPayload = {
  checkIn: string;
  checkOut: string;
  catCount: string;
  roomCount: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  petNames: string;
  indoorPet: "inde" | "ude";
  food: string;
  medicine: string;
  allowSocialMedia: boolean;
  note: string;
};

// Kapacitets-dag (bruges til både 7-dages widget og månedskalender)
export type CapacityDay = {
  date: string; // "YYYY-MM-DD"
  booked: number; // antal katte, der fylder kapacitet
  capacity: number;
  free: number;
};

/* ------------------------------------------------------------------ */
/*                        localStorage helpers                         */
/* ------------------------------------------------------------------ */

function isBrowser() {
  return typeof window !== "undefined";
}

function loadArray<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveArray<T>(key: string, value: T[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function loadObject<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveObject<T>(key: string, value: T) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// inklusivt start / inklusivt slut (bruges til kapacitet)
function eachDay(startIso: string, endIso: string): string[] {
  const res: string[] = [];
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res;

  const d = new Date(start);
  while (d <= end) {
    res.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/*                            Booking-API                              */
/* ------------------------------------------------------------------ */

/**
 * Hent alle bookinger for en kennel.
 * Bruges både til ejer-forespørgsler og interne bookinger.
 */
export async function listBookingsForKennel(
  kennelId: string
): Promise<BookingRecord[]> {
  const all = loadArray<BookingRecord>(BOOKING_KEY);

  // Sørg for at gamle poster uden status får "pending"
  return all
    .map((b) => ({
      ...b,
      status: (b.status ?? "pending") as BookingStatus,
    }))
    .filter((b) => !kennelId || b.kennelId === kennelId);
}

/**
 * Opret booking (typisk fra intern bookingformular).
 */
export async function createBooking(
  kennelId: string,
  data: Omit<
    BookingRecord,
    "id" | "createdAt" | "kennelId" | "status" | "source"
  > & {
    status?: BookingStatus;
    source?: BookingSource;
  }
): Promise<BookingRecord> {
  const all = loadArray<BookingRecord>(BOOKING_KEY);

  const record: BookingRecord = {
    id: newId("b"),
    kennelId,
    createdAt: new Date().toISOString(),
    status: data.status ?? "pending",
    source: data.source ?? "internal",
    ...data,
  };

  all.push(record);
  saveArray(BOOKING_KEY, all);
  return record;
}

/**
 * Opdater en eksisterende booking.
 */
export async function updateBooking(
  record: BookingRecord
): Promise<BookingRecord> {
  const all = loadArray<BookingRecord>(BOOKING_KEY);
  const idx = all.findIndex((b) => b.id === record.id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...record };
  } else {
    all.push(record);
  }
  saveArray(BOOKING_KEY, all);
  return record;
}

/**
 * Sæt booking-status (fx "precheck", "cancelled" eller "converted").
 */
export async function setBookingStatus(
  id: string,
  status: BookingStatus
): Promise<BookingRecord | null> {
  const all = loadArray<BookingRecord>(BOOKING_KEY);
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status };
  saveArray(BOOKING_KEY, all);
  return all[idx];
}

/**
 * Hjælper: acceptér / afvis booking fra kennel-UI.
 */
export async function acceptBooking(id: string) {
  return setBookingStatus(id, "precheck");
}

export async function cancelBooking(id: string) {
  return setBookingStatus(id, "cancelled");
}

/* ------------------------------------------------------------------ */
/*                         Check-in / ophold-API                       */
/* ------------------------------------------------------------------ */

/**
 * Hent alle ophold (check-ins) for kennel.
 */
export async function listCheckinsForKennel(
  kennelId: string
): Promise<CheckinRecord[]> {
  const all = loadArray<CheckinRecord>(CHECKIN_KEY);
  return all.filter((c) => !kennelId || c.kennelId === kennelId);
}

/**
 * Opret et aktivt ophold ud fra en booking.
 * Booking markeres som "converted", så den ikke tæller dobbelt.
 */
export async function createCheckinFromBooking(
  booking: BookingRecord,
  overrides: Partial<CheckinRecord> = {}
): Promise<CheckinRecord> {
  const all = loadArray<CheckinRecord>(CHECKIN_KEY);

  const record: CheckinRecord = {
    ...booking,
    id: newId("c"),
    status: "checked_in",
    cageId: null,
    ...overrides,
  };

  all.push(record);
  saveArray(CHECKIN_KEY, all);

  // markér booking som "converted"
  await setBookingStatus(booking.id, "converted");

  return record;
}

/**
 * Opdater et ophold (fx bur, datoer, note, status).
 */
export async function updateCheckin(
  record: CheckinRecord
): Promise<CheckinRecord> {
  const all = loadArray<CheckinRecord>(CHECKIN_KEY);
  const idx = all.findIndex((c) => c.id === record.id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...record };
  } else {
    all.push(record);
  }
  saveArray(CHECKIN_KEY, all);
  return record;
}

/**
 * Tjek et ophold ud (status → "checked_out").
 */
export async function checkOutCheckin(id: string): Promise<void> {
  const all = loadArray<CheckinRecord>(CHECKIN_KEY);
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status: "checked_out" };
  saveArray(CHECKIN_KEY, all);
}

/**
 * Simpel helper til kun at opdatere bur på et ophold.
 */
export async function assignCageToCheckin(
  checkinId: string,
  cageId: string | null
): Promise<CheckinRecord | null> {
  const all = loadArray<CheckinRecord>(CHECKIN_KEY);
  const idx = all.findIndex((c) => c.id === checkinId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], cageId };
  saveArray(CHECKIN_KEY, all);
  return all[idx];
}

/* ------------------------------------------------------------------ */
/*                             Bur-API                                 */
/* ------------------------------------------------------------------ */

export async function listCagesForKennel(
  kennelId: string
): Promise<KennelCage[]> {
  const all = loadArray<KennelCage>(CAGE_KEY);
  return all.filter((c) => c.kennelId === kennelId);
}

export async function upsertCage(
  kennelId: string,
  cage: Omit<KennelCage, "kennelId" | "id"> & { id?: string }
): Promise<KennelCage> {
  const all = loadArray<KennelCage>(CAGE_KEY);

  if (cage.id) {
    const idx = all.findIndex((c) => c.id === cage.id);
    const base = idx >= 0 ? all[idx] : undefined;
    const updated: KennelCage = {
      ...(base ?? {
        id: cage.id,
        kennelId,
        name: cage.name,
      }),
      ...cage,
      kennelId,
    };
    if (idx >= 0) {
      all[idx] = updated;
    } else {
      all.push(updated);
    }
    saveArray(CAGE_KEY, all);
    return updated;
  }

  const created: KennelCage = {
    id: newId("g"),
    kennelId,
    name: cage.name,
    size: cage.size,
    location: cage.location,
    note: cage.note,
  };
  all.push(created);
  saveArray(CAGE_KEY, all);
  return created;
}

export async function deleteCage(
  kennelId: string,
  cageId: string
): Promise<void> {
  const all = loadArray<KennelCage>(CAGE_KEY).filter(
    (c) => !(c.kennelId === kennelId && c.id === cageId)
  );
  saveArray(CAGE_KEY, all);
}

/* ------------------------------------------------------------------ */
/*                           Profil-API                                */
/* ------------------------------------------------------------------ */

const DEFAULT_PROFILE: KennelProfile = {
  id: KENNEL_ID,
  name: "Annisse Kattepension",
  tagline: "Luksuriøs, familiedrevet kattepension",
  nightlyRate: 325,
  addressLine1: "Kattegangen 12",
  postalCode: "3200",
  city: "Annisse",
  phone: "12 34 56 78",
  email: "kontakt@annisse-kattepension.dk",
  website: "https://annisse-kattepension.dk",

  // Bruges på forsiden (hero / intro-tekst)
  shortDescription:
    "Hos Annisse Kattepension får hver kat sit eget rummelige bur med adgang til både inde- og udeområde. Vi lægger vægt på ro, nærvær og gennemsigtighed – både for kat og ejer.",

  // Bruges til bullet-punkter (kan redigeres fra kennel-UI)
  sellingPoints:
    "Familiedrevet og nærværende hverdag\nEget bur til hver kat – ingen tvangssammensætning\nInde- og udeområde efter kattens temperament\nMulighed for opdateringer med billeder/video\nRoligt miljø med fokus på trivsel",

  // Bruges til praktisk info – fx på infosiden
  practicalInfo:
    "Katten skal være vaccineret efter gældende anbefalinger.\nMedbring gerne eget foder, hvis katten er kræsen eller på specialkost.\nMedicin gives efter aftale og noteres i bookingformularen.\nInd- og udtjek sker som udgangspunkt efter aftale for at sikre ro i huset.",

  // Bruges på siden "Betingelser"
  conditionsText:
    "Her kan du skrive dine egne betingelser for ophold i Annisse Kattepension. For eksempel betalingsbetingelser, afbestillingsregler, krav til vaccination, medicin, forsinket afhentning og andet praktisk.\n\nDen tekst du skriver her, vises direkte på siden “Betingelser” på hjemmesiden.",
};

export function loadKennelProfile(kennelId: string): KennelProfile {
  const stored = loadObject<KennelProfile | null>(PROFILE_KEY, null);
  if (!stored || stored.id !== kennelId) return DEFAULT_PROFILE;
  return { ...DEFAULT_PROFILE, ...stored };
}

export function saveKennelProfile(profile: KennelProfile) {
  saveObject(PROFILE_KEY, profile);
}

/* ------------------------------------------------------------------ */
/*                  Booking fra ejerens forside-formular               */
/* ------------------------------------------------------------------ */

/**
 * Ejerens bookingansøgning på forsiden.
 * Denne laver nu en RIGTIG booking i BOOKING_KEY med source = "owner",
 * så Min kennel kan se og håndtere den på samme måde som andre bookinger.
 */
export async function createBookingRequest(
  payload: OwnerBookingRequestPayload,
  kennelId: string = KENNEL_ID
): Promise<BookingRecord> {
  const all = loadArray<BookingRecord>(BOOKING_KEY);

  const catCount = Number(payload.catCount || "1") || 1;
  const roomCount = Number(payload.roomCount || "1") || 1;

  const record: BookingRecord = {
    id: newId("b"),
    kennelId,
    createdAt: new Date().toISOString(),
    status: "pending",
    source: "owner",

    checkIn: payload.checkIn,
    checkOut: payload.checkOut,

    petName: payload.petNames,
    petNames: payload.petNames,
    catCount,
    roomCount,

    ownerName: payload.ownerName,
    ownerPhone: payload.ownerPhone,
    ownerEmail: payload.ownerEmail,

    note: payload.note,

    indoorPet: payload.indoorPet,
    food: payload.food,
    medicine: payload.medicine,
    allowSocialMedia: payload.allowSocialMedia,
  };

  all.push(record);
  saveArray(BOOKING_KEY, all);

  // Returnér samme struktur som andre bookinger
  return record;
}

/* ------------------------------------------------------------------ */
/*                       Kapacitets-beregning API                      */
/* ------------------------------------------------------------------ */

/**
 * Beregn kapacitet for et datointerval (inkl. start & slut),
 * baseret på:
 *  - aktive ophold (checkins)
 *  - bookinger der er accepteret (status = "precheck")
 *  - FIXED_DAILY_CAPACITY (6 pladser pr. dag)
 */
export async function getCapacityForRange(
  kennelId: string,
  startDateIso: string,
  endDateIso: string
): Promise<CapacityDay[]> {
  const [bookings, checkins] = await Promise.all([
    listBookingsForKennel(kennelId),
    listCheckinsForKennel(kennelId),
  ]);

  const capacityPerDay = FIXED_DAILY_CAPACITY;

  const dates = eachDay(startDateIso, endDateIso);

  function overlapsDay(
    startIso: string | undefined,
    endIso: string | undefined,
    dayIso: string
  ): boolean {
    if (!startIso || !endIso) return false;
    // [start, end) logik: checkIn <= dag < checkOut
    return startIso <= dayIso && dayIso < endIso;
  }

  return dates.map((date) => {
    let booked = 0;

    // 1) aktive ophold (checkins)
    for (const stay of checkins) {
      const status = (stay as any).status;
      const isCheckedOut =
        status === "checked_out" || status === "checkedOut";
      if (isCheckedOut) continue;

      if (overlapsDay(stay.checkIn, stay.checkOut, date)) {
        const count = (stay as any).catCount || 1;
        booked += count;
      }
    }

    // 2) bookinger der er accepteret (precheck)
    for (const b of bookings) {
      const status = (b as any).status || "pending";
      if (status !== "precheck") continue;

      if (overlapsDay(b.checkIn, b.checkOut, date)) {
        const count = (b as any).catCount || 1;
        booked += count;
      }
    }

    const cappedBooked = Math.min(booked, capacityPerDay);
    const free = Math.max(0, capacityPerDay - cappedBooked);

    return {
      date,
      booked: cappedBooked,
      capacity: capacityPerDay,
      free,
    };
  });
}

/**
 * Helper der bruges fra kennel-UI:
 * Tjek om der er kapacitet til en booking i hele perioden,
 * baseret på eksisterende accepterede bookinger + aktive ophold.
 */
export async function hasCapacityForBooking(
  kennelId: string,
  booking: BookingRecord
): Promise<boolean> {
  if (!booking.checkIn || !booking.checkOut) return false;

  const days = await getCapacityForRange(
    kennelId,
    booking.checkIn,
    booking.checkOut
  );
  const needed = booking.catCount || 1;

  return days.every((d) => d.booked + needed <= d.capacity);
}
