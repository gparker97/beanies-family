<script setup lang="ts">
import AiProcessingOverlay from '@/components/ai/AiProcessingOverlay.vue';
import { ref, computed, nextTick } from 'vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import TimelineSegmentCard from '@/components/travel/TimelineSegmentCard.vue';
import TripIdeasPanel from '@/components/travel/TripIdeasPanel.vue';
import ListDetailModal from '@/components/lists/ListDetailModal.vue';
import VacationWizard from '@/components/vacation/VacationWizard.vue';
import TripBadgeChip from '@/components/vacation/TripBadgeChip.vue';
import TripDatesHeader from '@/components/travel/TripDatesHeader.vue';
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import AccommodationEditModal from '@/components/travel/AccommodationEditModal.vue';
import TransportationEditModal from '@/components/travel/TransportationEditModal.vue';
import IdeaEditModal from '@/components/travel/IdeaEditModal.vue';
import TravelExtractReviewModal from '@/components/travel/TravelExtractReviewModal.vue';
import { useVacationStore } from '@/stores/vacationStore';
import { usePhotoStore } from '@/stores/photoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { useClipboard } from '@/composables/useClipboard';
import { confirm } from '@/composables/useConfirm';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { usePermissions } from '@/composables/usePermissions';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { showToast } from '@/composables/useToast';
import { useDocumentToTravel, type TravelReady } from '@/composables/useDocumentToTravel';
import { useDocumentConsent, type ConsentGrant } from '@/composables/useDocumentConsent';
import { useMagicReader, useMagicReaderConsumer } from '@/composables/useMagicReader';
import MagicReaderPill from '@/components/ai/MagicReaderPill.vue';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import { vacationSegmentEntityId } from '@/services/photos/photoCollectionHooks';
import { useVacationTimeline } from '@/composables/useVacationTimeline';
import type { TimelineItem } from '@/composables/useVacationTimeline';
import { formatDateShort, formatNookDate, extractDatePart } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import {
  tripTypeEmoji,
  bookingProgress,
  tripBadge,
  tripPhase,
  computeTimelineHints,
  classifyTripDay,
  tripDayNumber,
  tripDurationDays,
  overrideTripTarget,
} from '@/utils/vacation';
import TodayTimelineMarker from '@/components/travel/TodayTimelineMarker.vue';
import StayingNowChip from '@/components/travel/StayingNowChip.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import type { FamilyVacation, VacationIdea } from '@/types/models';

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const vacationStore = useVacationStore();
const familyStore = useFamilyStore();
const { copied } = useClipboard();
const photoStore = usePhotoStore();

// ── AI: add travel plans from a document (#30, flag-gated, prod-off) ───────────
// Gating for the document→trip reader lives in useMagicReader now (single source).
const { canReadDocument } = useMagicReader();
// The consent modal is mounted ONCE in App.vue (#64); this page only asks. The grant is
// held between the gate and the picker's file event — consent runs before the picker opens.
const { requestConsent } = useDocumentConsent();
let docGrant: ConsentGrant | null = null;

// The extracted payload handed to the review modal (null when closed).
const reviewReady = ref<TravelReady | null>(null);
// True while onReviewSubmit persists the trip + attaches the document — drives the modal's
// save spinner and locks its buttons so the create action never looks like a no-op.
const reviewSubmitting = ref(false);

// Set by `handleAddFromDocument(tripId)` when the reader is launched from a specific trip's
// detail page; consumed once in `onTravelReady` to default the review modal to that trip. Null
// when launched from the list header (target auto-resolves by date).
const pendingTripTarget = ref<string | null>(null);

const {
  isProcessing: isReadingDoc,
  processFile: processTravelDoc,
  deliverTravel,
} = useDocumentToTravel({
  onTravelReady: (ready) => {
    // If launched from a trip's detail page, default to that trip (modal still allows New/other).
    const target = overrideTripTarget(
      ready.target,
      pendingTripTarget.value,
      vacationStore.vacations
    );
    pendingTripTarget.value = null;
    reviewReady.value = { ...ready, target };
  },
});

// The AI document picker (a camera-or-file chooser on touch devices, a direct
// file dialog on desktop) is opened via its exposed pick() after consent; it
// emits the chosen file. See AiDocumentPicker.vue.
const aiDocPicker = ref<InstanceType<typeof AiDocumentPicker> | null>(null);

/**
 * 📄 entry point. Consent gate runs BEFORE the picker; a decline is a silent no-op. When called
 * with a `tripId` (from a trip's detail page), the review modal defaults to attaching to that
 * trip; the list-header call passes nothing → the target auto-resolves by date.
 */
async function handleAddFromDocument(tripId?: string): Promise<void> {
  pendingTripTarget.value = tripId ?? null;
  const granted = await requestConsent();
  if (!granted) {
    pendingTripTarget.value = null;
    return;
  }
  docGrant = granted;
  aiDocPicker.value?.pick();
}

// Document-reader cross-surface dispatch: the FAB card / new-trip-wizard banner
// set `pendingMagic` and route here; pick it up (watch + onMounted) and run it.
// A share arrives already extracted (#64), so it is DELIVERED rather than re-read — the
// alternative would be a second AI call for the same document. No payload means the magic
// affordance asked to open the picker, which is the original behaviour.
useMagicReaderConsumer(
  'document',
  (payload) => {
    if (payload) deliverTravel(payload.data, payload.env);
    else void handleAddFromDocument();
  },
  canReadDocument
);

/** Every created segment id across the buckets, in timeline order. */
function allSegmentIds(ready: TravelReady): string[] {
  const { travelSegments, accommodations, transportation } = ready.buckets;
  return [...travelSegments, ...accommodations, ...transportation].map((s) => s.id);
}

/**
 * Confirm handler: create the new trip or attach to the chosen one, then attach the source
 * document to the primary segment. A failed attach warns but never rolls back the saved trip
 * (mirrors updateVacation's activity-sync posture). Nothing fails silently.
 */

/**
 * Resolve each segment's `travellerIds` from the user-confirmed name→member map (the segment id
 * keys `travellerNamesBySegmentId`). A segment with no mapped members is left undefined so it
 * falls back to the trip default (new-trip union / dynamic for attach).
 */
function resolveSegmentTravellersFromMap(
  ready: TravelReady,
  travellerMap: Record<string, string>
): void {
  for (const seg of [
    ...ready.buckets.travelSegments,
    ...ready.buckets.accommodations,
    ...ready.buckets.transportation,
  ]) {
    const names = ready.travellerNamesBySegmentId[seg.id];
    if (!names?.length) continue;
    const ids = [...new Set(names.map((n) => travellerMap[n]).filter(Boolean))] as string[];
    if (ids.length) seg.travellerIds = ids;
  }
}

async function onReviewSubmit(payload: {
  target: { kind: 'create' } | { kind: 'attach'; vacationId: string };
  tripName: string;
  travellerMap: Record<string, string>;
  aliasesToLearn: Array<{ memberId: string; alias: string }>;
}): Promise<void> {
  const ready = reviewReady.value;
  if (!ready) return;
  const createdBy = familyStore.currentMemberId;
  if (!createdBy) {
    showToast('error', t('travelExtract.error.title'), t('travelExtract.error.noMember'));
    return;
  }

  reviewSubmitting.value = true;
  try {
    // Resolve segment travellers from the user-confirmed mapping FIRST, so the union +
    // materialize logic inside the store operates on resolved buckets.
    resolveSegmentTravellersFromMap(ready, payload.travellerMap);

    // ONE call, and the cross-store transaction now lives in the store where the two
    // traveller rules can be enforced structurally rather than by comment.
    const saved = await vacationStore.saveExtractedTrip(
      payload.target.kind === 'create'
        ? { kind: 'create', tripName: payload.tripName, tripType: ready.tripType }
        : { kind: 'attach', vacationId: payload.target.vacationId },
      ready.buckets,
      createdBy
    );

    if (!saved) {
      showToast('error', t('travelExtract.error.title'), t('travelExtract.error.saveFailed'));
      return;
    }
    const { vacationId, idRemap } = saved;

    // Attach the source document to EVERY final segment: store the file once, then link the
    // same photoId to the rest (no duplicate storage). Remapped + de-duped so it lands on the
    // merged-into existing segment rather than a dropped extracted id, and never double-links
    // when two extracted segments merge into one. Warn-not-rollback.
    const segIds = [...new Set(allSegmentIds(ready).map((id) => idRemap[id] ?? id))];
    // A trip captured from a shared LINK has no file to attach. Deliberately NOT an early
    // return — the trip itself must still save; only the photo step is skipped.
    if (segIds.length && ready.sourceFile) {
      try {
        const [firstId, ...restIds] = segIds;
        const { photoId } = await photoStore.addPhoto(
          ready.sourceFile,
          'vacations',
          vacationSegmentEntityId(vacationId, firstId),
          createdBy
        );
        for (const otherId of restIds) {
          photoStore.linkPhotoToEntity(
            'vacations',
            vacationSegmentEntityId(vacationId, otherId),
            photoId
          );
        }
      } catch (err) {
        console.error('[travel-extract] document attach failed (trip kept):', err);
        showToast(
          'warning',
          t('travelExtract.attachFailed.title'),
          t('travelExtract.attachFailed.message')
        );
      }
    }

    // Learn the confirmed legal-name → member mappings so they auto-match next time. The
    // one-write-per-member rule that makes this correct now lives in familyStore.learnAliases.
    try {
      await familyStore.learnAliases(payload.aliasesToLearn);
    } catch (err) {
      console.error('[travel-extract] alias learning failed:', err);
      showToast(
        'warning',
        t('travelExtract.aliasLearnFailed.title'),
        t('travelExtract.aliasLearnFailed.message')
      );
    }

    reviewReady.value = null;
    selectedVacationId.value = vacationId;
    showToast('success', t('travelExtract.added.title'), t('travelExtract.added.message'));
  } finally {
    reviewSubmitting.value = false;
  }
}

// ── State ────────────────────────────────────────────────────────────────────

const selectedVacationId = ref<string | null>(null);
const showPastTrips = ref(false);
const showVacationWizard = ref(false);
const editingVacation = ref<FamilyVacation | null>(null);
const editVacationStep = ref<number | undefined>(undefined);

// Add menu state (timeline bottom)
const showAddMenu = ref(false);

// Edit modal state
const editModalType = ref<'travel' | 'accommodation' | 'transportation' | null>(null);
const editingItemIndex = ref(-1);

// Collapsible segment cards
const collapsedCards = ref<Record<string, boolean>>({});

// Attachment lightbox for timeline segment documents. Supports remove via the
// standard PhotoViewer 🗑️ — `viewerSegmentId` tracks which segment the open
// photos belong to so a remove updates the right segment's photoIds.
const viewerOpen = ref(false);
const viewerPhotoIds = ref<string[]>([]);
const viewerIndex = ref(0);
const viewerSegmentId = ref<string | null>(null);
function openAttachmentViewer(segmentId: string, photoIds: string[], photoId: string): void {
  viewerSegmentId.value = segmentId;
  viewerPhotoIds.value = photoIds;
  viewerIndex.value = Math.max(0, photoIds.indexOf(photoId));
  viewerOpen.value = true;
}

/**
 * Remove a booking document from the open segment. Mirrors `usePhotos.remove`:
 * tombstone the photo (24h GC reclaims Drive + Automerge) and detach it from the
 * segment's `photoIds`. The viewer closes itself after emitting remove.
 */
async function onAttachmentRemove(photoId: string): Promise<void> {
  const vacationId = selectedVacationId.value;
  const segmentId = viewerSegmentId.value;
  if (!vacationId || !segmentId) return;
  photoStore.markDeleted(photoId);
  const nextIds = viewerPhotoIds.value.filter((id) => id !== photoId);
  viewerPhotoIds.value = nextIds;
  await vacationStore.updateSegmentPhotoIds(vacationId, segmentId, nextIds);
}

// Linked Beanie List opened from the embed — shown as a drawer over this page
// (no navigation), so closing it leaves the user on the trip. `null` = closed.
const linkedListId = ref<string | null>(null);

// Ideas state
const quickIdeaText = ref('');
const editingIdeaId = ref<string | null>(null);
// A COMPONENT ref now that the panel is extracted, so reach its root element through $el.
// `scrollIntoView` on the component instance itself is not a function and would throw.
const ideasPanelRef = ref<{ $el: HTMLElement; focusQuickAdd: () => void } | null>(null);

function scrollToIdeas() {
  ideasPanelRef.value?.$el?.scrollIntoView({ behavior: 'smooth' });
}

// ── Query param: auto-select vacation from ?vacation=ID ──────────────────────

// Auto-select a trip from a deep link (?vacation=<id>). Robust to cold-start:
// only clears the param once the trip exists, and retries when trips hydrate.
useDeepLinkParam({
  param: 'vacation',
  open: (id) => {
    if (!vacationStore.getVacationById(id)) return false;
    selectedVacationId.value = id;
    return true;
  },
  ready: () => vacationStore.vacations.length,
});

// ── Computed ─────────────────────────────────────────────────────────────────

const selectedVacation = computed(() =>
  selectedVacationId.value ? vacationStore.getVacationById(selectedVacationId.value) : undefined
);

const { today: todayISO } = useToday();
const { groupedByDate, accommodationGaps, undatedItems } = useVacationTimeline(
  selectedVacation,
  todayISO
);

/** Merged timeline: interleave date groups with gap warnings.
 *  The "you are here" today indicator is rendered inline inside today's
 *  date-group as a subordinate chip below the date header (see
 *  `<TodayTimelineMarker>` in the template), not as a separate entry.
 *  This keeps every day's rail circle + "Day N · date" header consistent
 *  across past / today / future. */
type TimelineEntry =
  | { type: 'group'; data: (typeof groupedByDate)['value'][number] }
  | { type: 'gap'; date: string; label: string };

/** Split ideas into unplanned and planned */
const unplannedIdeas = computed(
  () => selectedVacation.value?.ideas.filter((i) => !i.isPlanned) ?? []
);
const plannedIdeas = computed(() => selectedVacation.value?.ideas.filter((i) => i.isPlanned) ?? []);

/** Hints keyed by item ID — used to tint affected segment cards */
const hintMap = computed(() =>
  selectedVacation.value ? computeTimelineHints(selectedVacation.value, t) : new Map()
);

/**
 * Item IDs whose dates fall outside the trip window. Pulled via the
 * structured `outOfRange` flag on each hint so the banner stays
 * consistent with `detectOutOfRange` even as message copy evolves.
 */
const outOfRangeHints = computed(() => {
  const ids: string[] = [];
  for (const [id, hint] of hintMap.value) {
    if (hint.outOfRange) ids.push(id);
  }
  return ids;
});

function scrollToOutOfRange(): void {
  const firstId = outOfRangeHints.value[0];
  if (!firstId) return;
  const el = document.querySelector(`[data-segment-id="${firstId}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/** True when today falls inside `[tripStart, tripEnd]` inclusive. */
const isMidTrip = computed(() => {
  const v = selectedVacation.value;
  if (!v?.startDate || !v?.endDate) return false;
  const start = extractDatePart(v.startDate);
  const end = extractDatePart(v.endDate);
  return todayISO.value >= start && todayISO.value <= end;
});

const mergedTimeline = computed<TimelineEntry[]>(() => {
  const entries: TimelineEntry[] = [];
  for (const g of groupedByDate.value) {
    entries.push({ type: 'group', data: g });
  }
  for (const gapDate of accommodationGaps.value) {
    entries.push({ type: 'gap', date: gapDate, label: formatNookDate(gapDate) });
  }

  // Inject a synthetic empty group for today when mid-trip and we don't
  // already have a real one. Ensures today renders the same "Day N · date"
  // header as every other day even on free-rest days with no segments —
  // the inline <TodayTimelineMarker> chip below the header then adds the
  // "you are here" cue without breaking the consistent header pattern.
  if (isMidTrip.value && selectedVacation.value?.startDate) {
    const today = todayISO.value;
    const hasGroup = entries.some((e) => e.type === 'group' && e.data.date === today);
    if (!hasGroup) {
      entries.push({
        type: 'group',
        data: {
          date: today,
          label: formatNookDate(today),
          items: [],
        },
      });
    }
  }

  entries.sort((a, b) => {
    const dateA = a.type === 'group' ? a.data.date : a.date;
    const dateB = b.type === 'group' ? b.data.date : b.date;
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    // Same-date tiebreak: group first (provides the canonical date header),
    // then gap (whose date-header is suppressed via the groupDates lookup
    // when a group already names the date).
    const prio = (e: TimelineEntry) => (e.type === 'group' ? 0 : 1);
    return prio(a) - prio(b);
  });
  return entries;
});

/** Trip-relative info for the inline TodayTimelineMarker chip. */
const todayMarkerInfo = computed(() => {
  const v = selectedVacation.value;
  if (!isMidTrip.value || !v?.startDate || !v?.endDate) return null;
  const dayNumber = tripDayNumber(todayISO.value, v.startDate) ?? 0;
  const totalDays = tripDurationDays(v.startDate, v.endDate);
  const hasSegmentsToday = groupedByDate.value.some((g) => g.date === todayISO.value);
  return {
    dayNumber,
    totalDays,
    isFreeDay: !hasSegmentsToday,
  };
});

/** Set of dates that have a group entry (real or synthetic). Used to
 *  suppress duplicate date headers on gap entries that share a date with
 *  an existing group — the group's header already names the date, so the
 *  gap can render its card alone. */
const groupDates = computed(
  () =>
    new Set(
      mergedTimeline.value
        .filter((e): e is Extract<TimelineEntry, { type: 'group' }> => e.type === 'group')
        .map((e) => e.data.date)
    )
);

const upcomingVacations = computed(() => vacationStore.upcomingVacations);

/**
 * The exact complement of the store's `upcomingVacations` (`tripPhase !== 'past'`).
 * Previously this filtered on `new Date().toISOString().slice(0,10)` — a UTC day —
 * which could disagree with the store's local-day phase around midnight, letting a
 * trip fall into both lists or neither. `todayISO` is local and reactive to a
 * day-roll; `tripPhase` is the single definition of "past".
 */
const pastVacations = computed(() =>
  vacationStore.vacations
    .filter((v) => tripPhase(v, todayISO.value) === 'past')
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
);

const hasTrips = computed(
  () => upcomingVacations.value.length > 0 || pastVacations.value.length > 0
);

function vacationProgress(v: FamilyVacation) {
  return bookingProgress(v);
}

/**
 * One badge per trip, resolved once. `tripBadge` decides which — never a stale
 * "completed" on a trip that is currently happening, which is what the old
 * `daysUntilTrip(startDate) <= 0` test produced the moment a trip began.
 *
 * Keyed by id and computed in one pass so the `v-for` doesn't re-run `tripPhase`
 * + `tripDayProgress` once per template branch.
 */
const badgesById = computed(
  () => new Map(upcomingVacations.value.map((v) => [v.id, tripBadge(v, todayISO.value)]))
);

const selectedBadge = computed(() =>
  selectedVacation.value ? tripBadge(selectedVacation.value, todayISO.value) : null
);

function vacationDateRange(v: FamilyVacation) {
  if (!v.startDate) return '';
  const start = formatDateShort(v.startDate);
  const end = v.endDate ? formatDateShort(v.endDate) : '';
  return end ? `${start} – ${end}` : start;
}

function vacationAssignees(v: FamilyVacation) {
  return (v.assigneeIds ?? [])
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; color: string }>;
}

/** Count of ideas on this trip that the family hasn't decided on yet —
 *  neither marked planned nor skipped. A per-trip planning stat only; the nav
 *  badge now counts unbooked bookings (`unbookedTravel`), which the per-trip
 *  "needs booking" indicator (`vacationProgress`) sums to instead. */

// ── Navigation ───────────────────────────────────────────────────────────────

function selectTrip(id: string) {
  selectedVacationId.value = id;
  collapsedCards.value = {};
}

function backToList() {
  selectedVacationId.value = null;
}

async function deleteTrip() {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  const confirmed = await confirm({
    title: 'vacation.deleteTitle',
    message: 'vacation.deleteMessage',
    variant: 'danger',
  });
  if (confirmed) {
    await vacationStore.deleteVacation(selectedVacation.value.id);
    selectedVacationId.value = null;
  }
}

function startWizard() {
  editingVacation.value = null;
  editVacationStep.value = undefined;
  showVacationWizard.value = true;
}

// Quick-add FAB handlers.
//
// - `add-trip` opens the vacation wizard fresh.
// - `add-trip-idea` requires a parent trip. If the user arrived with a
//   `vacationId` (on a trip detail route) we select that one and focus
//   the inline quick-idea input. Without context, we pick the first
//   trip if any exist, or fire an info toast with a "Create trip"
//   action so the user isn't left guessing why nothing happened.
function handleAddTripIdea(vacationId: string | undefined): void {
  const vacations = vacationStore.vacations;
  if (vacations.length === 0) {
    showToast('info', t('quickAdd.tripIdea.noTripsTitle'), t('quickAdd.tripIdea.noTripsMessage'), {
      actionLabel: t('quickAdd.tripIdea.addTripAction'),
      actionFn: () => {
        startWizard();
      },
    });
    return;
  }

  const targetId =
    vacationId && vacations.some((v) => v.id === vacationId) ? vacationId : vacations[0].id;
  selectedVacationId.value = targetId;

  // Wait for the ideas panel to render (route/state change may re-mount
  // it), then focus the quick-add input so the user can type immediately.
  void nextTick().then(() => {
    scrollToIdeas();
    ideasPanelRef.value?.focusQuickAdd();
  });
}

/**
 * ONE permission gate for every mutation on this surface.
 *
 * `canEditActivities` was consulted exactly once in 1925 lines, while `:read-only` was
 * hard-coded to `false` on both segment cards — so a view-only family member could rename a
 * flight, delete a segment, delete the whole trip, add ideas and vote. FamilyPlannerPage
 * binds `:read-only="!canEditActivities"` for the same component; this surface simply never
 * did.
 *
 * A helper rather than an inline check per handler, because twelve copies of an invariant is
 * how eleven of them end up correct. The template still hides the affordances — this is the
 * backstop for the paths that do not go through a button (quick-add intents, keyboard, a
 * stale view after a role change).
 */
function requireEdit(): boolean {
  if (canEditActivities.value) return true;
  showToast('info', t('permissions.readOnly.title'), t('permissions.readOnly.message'));
  return false;
}

useQuickAddIntent((action, { vacationId }) => {
  if (!canEditActivities.value) return;
  switch (action) {
    case 'add-trip':
      startWizard();
      break;
    case 'add-trip-idea':
      handleAddTripIdea(vacationId);
      break;
    default:
      break;
  }
});

function editInWizard(step: number) {
  if (selectedVacation.value) {
    editingVacation.value = selectedVacation.value;
    editVacationStep.value = step;
    showVacationWizard.value = true;
  }
}

function addSegmentViaWizard(step: number) {
  showAddMenu.value = false;
  editInWizard(step);
}

async function addActivitySegment() {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  showAddMenu.value = false;
  const id = selectedVacation.value.id;
  const newSeg = {
    id: crypto.randomUUID(),
    type: 'activity' as const,
    title: '',
    status: 'pending' as const,
  };
  const travelSegments = [...selectedVacation.value.travelSegments, newSeg];
  await vacationStore.updateVacation(id, { travelSegments });
  // Open the edit modal for the new segment
  editingItemIndex.value = travelSegments.length - 1;
  editModalType.value = 'travel';
}

// ── Collapsible cards ────────────────────────────────────────────────────────

function isCollapsed(id: string): boolean {
  return collapsedCards.value[id] !== false;
}

function setCollapsed(id: string, val: boolean) {
  collapsedCards.value[id] = val;
}

// ── Edit modals ──────────────────────────────────────────────────────────────

/** Date fields that should also update sortDate on travel segments */
const TRAVEL_DATE_FIELDS = new Set(['departureDate', 'embarkationDate']);

/** Inline-edit a single field on a timeline item and save immediately */
/**
 * AWAITED, and the await is the point.
 *
 * These writes rebuild a whole array from `selectedVacation.value` and then persist it.
 * Fire-and-forget meant a second edit a moment later still read the array from BEFORE the
 * first write landed, so the first edit was silently overwritten — and the UI had already
 * cleared, so it looked saved. Awaiting serialises them against the same snapshot.
 */
async function saveInlineField(item: TimelineItem, field: string, value: string) {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  const id = selectedVacation.value.id;
  if (item.kind === 'travel') {
    const travelSegments = [...selectedVacation.value.travelSegments];
    const updated = { ...travelSegments[item.arrayIndex]!, [field]: value };
    // Keep sortDate in sync when a primary date field changes
    if (TRAVEL_DATE_FIELDS.has(field)) {
      updated.sortDate = value;
    }
    travelSegments[item.arrayIndex] = updated;
    await vacationStore.updateVacation(id, { travelSegments });
  } else if (item.kind === 'accommodation') {
    const accommodations = [...selectedVacation.value.accommodations];
    accommodations[item.arrayIndex] = { ...accommodations[item.arrayIndex]!, [field]: value };
    await vacationStore.updateVacation(id, { accommodations });
  } else if (item.kind === 'transportation') {
    const transportation = [...selectedVacation.value.transportation];
    transportation[item.arrayIndex] = { ...transportation[item.arrayIndex]!, [field]: value };
    await vacationStore.updateVacation(id, { transportation });
  }
}

function openEditModal(item: TimelineItem) {
  if (!requireEdit()) return;
  editingItemIndex.value = item.arrayIndex;
  editModalType.value = item.kind;
}

async function deleteTimelineItem(item: TimelineItem) {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  const id = selectedVacation.value.id;
  if (item.kind === 'travel') {
    const travelSegments = selectedVacation.value.travelSegments.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { travelSegments });
  } else if (item.kind === 'accommodation') {
    const accommodations = selectedVacation.value.accommodations.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { accommodations });
  } else if (item.kind === 'transportation') {
    const transportation = selectedVacation.value.transportation.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { transportation });
  }
}

function closeEditModal() {
  editModalType.value = null;
  editingItemIndex.value = -1;
}

// Current editing items for modals
const editingTravelSegment = computed(() => {
  if (editModalType.value !== 'travel' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.travelSegments[editingItemIndex.value]
    : undefined;
});

const editingAccommodation = computed(() => {
  if (editModalType.value !== 'accommodation' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.accommodations[editingItemIndex.value]
    : undefined;
});

const editingTransportation = computed(() => {
  if (editModalType.value !== 'transportation' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.transportation[editingItemIndex.value]
    : undefined;
});

// ── Ideas ────────────────────────────────────────────────────────────────────

function handleVote(ideaId: string) {
  if (!requireEdit()) return;
  if (!selectedVacation.value || !familyStore.currentMemberId) return;
  vacationStore.toggleIdeaVote(selectedVacation.value.id, ideaId, familyStore.currentMemberId);
}

async function handleIdeaUpdate(updatedIdea: VacationIdea) {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  const ideas = selectedVacation.value.ideas.map((i) =>
    i.id === updatedIdea.id ? updatedIdea : i
  );
  await vacationStore.updateVacation(selectedVacation.value.id, { ideas });
}

async function handleIdeaDelete(ideaId: string) {
  if (!requireEdit()) return;
  if (!selectedVacation.value) return;
  const confirmed = await confirm({
    title: 'vacation.deleteSegmentTitle',
    message: 'vacation.deleteSegmentMessage',
    variant: 'danger',
  });
  if (!confirmed) return;
  const ideas = selectedVacation.value.ideas.filter((i) => i.id !== ideaId);
  await vacationStore.updateVacation(selectedVacation.value.id, { ideas });
}

const editingIdea = computed(() =>
  editingIdeaId.value && selectedVacation.value
    ? selectedVacation.value.ideas.find((i) => i.id === editingIdeaId.value)
    : undefined
);

function openIdeaEdit(ideaId: string) {
  editingIdeaId.value = ideaId;
}

function closeIdeaEdit() {
  editingIdeaId.value = null;
}

/**
 * THE CLEAREST CASE OF THE RACE. Type "snorkelling", Enter, then "beach day" a second later:
 * the second call read the ideas array from BEFORE the first write landed and persisted
 * [...oldIdeas, 'beach day'] — "snorkelling" gone. The input was cleared either way, so it
 * looked saved. Awaited, and the input clears only once the write actually lands.
 */
async function addQuickIdea() {
  if (!requireEdit()) return;
  const text = quickIdeaText.value.trim();
  if (!text || !selectedVacation.value || !familyStore.currentMemberId) return;
  const newIdea: VacationIdea = {
    id: crypto.randomUUID(),
    title: text,
    votes: [],
    createdBy: familyStore.currentMemberId,
    createdAt: new Date().toISOString(),
  };
  const ideas = [...selectedVacation.value.ideas, newIdea];
  const saved = await vacationStore.updateVacation(selectedVacation.value.id, { ideas });
  // Keep what they typed if the write failed — clearing it would discard the idea silently.
  if (saved) quickIdeaText.value = '';
}
</script>

<template>
  <div class="space-y-6">
    <!-- ═══════════════════════════════════════════════════════════════════════
         LIST VIEW — when no trip is selected
         ═══════════════════════════════════════════════════════════════════════ -->
    <template v-if="!selectedVacationId">
      <!-- Page welcome subtitle convention (#33): handwritten orange Caveat line,
           matching Beanie Lists / To-Dos (no bold title bar). -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <PageWelcomeSubtitle :text="t('travel.subtitle')" />
        <div class="flex flex-wrap items-center gap-2">
          <MagicReaderPill
            v-if="canReadDocument"
            :label="t('ai.magic.perform')"
            @click="handleAddFromDocument"
          />
          <button
            v-if="canEditActivities"
            type="button"
            class="font-outfit inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(0,180,216,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(0,180,216,0.3)]"
            @click="startWizard"
          >
            {{ t('travel.planATrip') }} 🌴
          </button>
        </div>
      </div>

      <!-- Upcoming trip cards -->
      <div
        v-if="upcomingVacations.length > 0"
        class="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
      >
        <TripCard
          v-for="vacation in upcomingVacations"
          :key="vacation.id"
          :vacation="vacation"
          :badge="badgesById.get(vacation.id) ?? null"
          @open="selectTrip(vacation.id)"
        />
      </div>

      <!-- Past trips (collapsible) -->
      <div v-if="pastVacations.length > 0" class="mt-2">
        <button
          type="button"
          class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          @click="showPastTrips = !showPastTrips"
        >
          <span class="text-xs opacity-50">{{ showPastTrips ? '▲' : '▼' }}</span>
          <span class="font-outfit text-sm font-semibold text-gray-400">
            {{ t('travel.pastTrips') }} ({{ pastVacations.length }})
          </span>
        </button>

        <div
          v-if="showPastTrips"
          class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
        >
          <div
            v-for="vacation in pastVacations"
            :key="vacation.id"
            class="focus-visible:ring-primary-500 cursor-pointer overflow-hidden rounded-3xl border-[1.5px] border-[var(--tint-slate-5)] bg-white opacity-50 shadow-[var(--card-shadow)] transition-all duration-200 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-slate-800"
            role="button"
            tabindex="0"
            :aria-label="fillTemplate(t('travel.openTrip'), { name: vacation.name })"
            @click="selectTrip(vacation.id)"
            @keydown.enter.prevent="selectTrip(vacation.id)"
            @keydown.space.prevent="selectTrip(vacation.id)"
          >
            <div
              class="relative flex h-20 items-center justify-center overflow-hidden"
              style="background: linear-gradient(135deg, rgb(0 180 216 / 4%), rgb(44 62 80 / 3%))"
            >
              <span class="relative z-10 text-4xl">
                {{ tripTypeEmoji(vacation.tripType, vacation.tripPurpose) }}
              </span>
            </div>
            <div class="p-4">
              <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
                {{ vacation.name }}
              </h3>
              <div
                v-if="vacationDateRange(vacation)"
                class="font-outfit mt-1 text-xs text-gray-400"
              >
                📅 {{ vacationDateRange(vacation) }}
              </div>
              <span
                class="font-outfit mt-2 inline-block rounded-lg bg-[var(--tint-slate-5)] px-2.5 py-1 text-[0.6875rem] font-semibold text-gray-400"
              >
                ✓ {{ t('travel.completed') }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state (only when no trips at all) -->
      <BaseCard v-if="!hasTrips">
        <div
          class="rounded-3xl border-2 border-dashed border-[rgba(0,180,216,0.15)] py-16 text-center"
        >
          <span class="mb-3 block text-5xl">✈️</span>
          <h3 class="font-outfit mb-1 text-lg font-bold text-gray-900 dark:text-gray-100">
            {{ t('travel.empty') }}
          </h3>
          <p class="mx-auto mb-5 max-w-sm text-sm text-gray-400 dark:text-gray-500">
            {{ t('travel.emptySubtitle') }}
          </p>
          <button
            type="button"
            class="font-outfit inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(0,180,216,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(0,180,216,0.3)]"
            @click="startWizard"
          >
            {{ t('travel.planATrip') }} 🌴
          </button>
        </div>
      </BaseCard>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════
         EXPANDED VIEW — when a trip is selected
         ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="selectedVacation">
      <!-- Back to all trips -->
      <button
        type="button"
        class="font-outfit mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        @click="backToList"
      >
        ← {{ t('travel.allTrips') }}
      </button>

      <!-- Hero banner -->
      <div
        class="relative overflow-hidden rounded-3xl shadow-[var(--card-shadow)]"
        style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
      >
        <!-- Decorative -->
        <div
          class="absolute -top-10 -right-8 h-44 w-44 rounded-full"
          style="background: radial-gradient(circle, rgb(255 217 61 / 14%), transparent 70%)"
        />

        <div class="relative z-10 px-6 py-5">
          <!-- Actions row -->
          <div class="mb-3 flex items-center justify-end gap-1.5">
            <!-- ✨ Beanies AI — read a booking into THIS trip. Same responsive pill as
                 everywhere else; defaults the review modal to the open trip (user can
                 still switch to New / another trip). -->
            <MagicReaderPill
              v-if="canReadDocument"
              :label="t('ai.magic.perform')"
              @click="handleAddFromDocument(selectedVacation.id)"
            />
            <div class="flex gap-1.5">
              <button
                type="button"
                class="font-outfit inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-white/20 bg-white/15 px-4 py-1.5 text-xs font-semibold text-white/90 shadow-sm backdrop-blur transition-all hover:border-white/30 hover:bg-white/25 hover:text-white"
                @click="editInWizard(1)"
              >
                ✏️ {{ t('travel.editTravelPlans') }}
              </button>
              <button
                type="button"
                class="font-outfit inline-flex items-center justify-center rounded-full border-[1.5px] border-white/30 bg-white/15 px-2.5 py-1.5 text-xs text-white transition-all hover:border-red-400/40 hover:bg-red-500/20 hover:text-red-200"
                :title="t('vacation.deleteTitle')"
                @click="deleteTrip"
              >
                🗑️
              </button>
            </div>
          </div>

          <!-- Row 2: emoji + name -->
          <div class="flex items-center gap-3.5">
            <span
              class="shrink-0 text-[2.5rem] drop-shadow-lg"
              style="animation: hero-float 4s ease-in-out infinite"
            >
              {{ tripTypeEmoji(selectedVacation.tripType, selectedVacation.tripPurpose) }}
            </span>
            <div class="min-w-0 flex-1">
              <h2 class="font-outfit text-xl font-extrabold text-white sm:text-[1.375rem]">
                {{ selectedVacation.name }}
              </h2>
              <div class="mt-0.5 text-xs text-white/50">
                📅 {{ vacationDateRange(selectedVacation) }}
              </div>
            </div>
          </div>

          <!-- Row 3: countdown + members -->
          <div class="mt-3 flex flex-wrap items-center gap-2.5">
            <TripBadgeChip :badge="selectedBadge" variant="header" />

            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="member in vacationAssignees(selectedVacation)"
                :key="member.id"
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-white/8 px-2.5 py-0.5 text-[0.6875rem] font-medium text-white/75"
              >
                <span
                  class="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold text-white"
                  :style="{ backgroundColor: member.color }"
                >
                  {{ member.name.charAt(0).toUpperCase() }}
                </span>
                {{ member.name }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Two-column layout -->
      <div class="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_340px]">
        <!-- LEFT: Timeline -->
        <div class="min-w-0 pr-0 lg:pr-6">
          <!-- Trip dates header (display + edit) -->
          <TripDatesHeader :vacation="selectedVacation" />

          <!-- Out-of-range warning banner -->
          <ErrorBanner
            :show="outOfRangeHints.length > 0"
            severity="warning"
            class="!static !z-auto mb-4 !rounded-2xl !shadow-none"
          >
            <template #title>
              {{ t('travel.outOfRange.bannerTitle') }}
            </template>
            <template #message>
              {{ outOfRangeHints.length }} ·
              {{ vacationDateRange(selectedVacation) }}
            </template>
            <template #actions>
              <button
                type="button"
                class="font-outfit rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/30"
                @click="scrollToOutOfRange"
              >
                {{ t('travel.outOfRange.bannerAction') }}
              </button>
            </template>
          </ErrorBanner>

          <!-- Progress banner -->
          <div
            v-if="vacationProgress(selectedVacation).total > 0"
            class="mb-5 flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] p-3 dark:bg-slate-800"
          >
            <span class="text-base">📋</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
              <div
                class="h-full rounded-full transition-all duration-500"
                style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
                :style="{ width: vacationProgress(selectedVacation).percent + '%' }"
              />
            </div>
            <span class="font-outfit text-xs font-semibold whitespace-nowrap text-[#00B4D8]">
              {{
                t('travel.bookedOf')
                  .replace('{booked}', String(vacationProgress(selectedVacation).booked))
                  .replace('{total}', String(vacationProgress(selectedVacation).total))
              }}
            </span>
          </div>

          <!-- Ideas teaser (responsive: hidden on lg, visible on mobile/tablet) -->
          <div
            v-if="selectedVacation.ideas.length > 0"
            class="focus-visible:ring-primary-500 mb-5 flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-[rgba(255,217,61,0.12)] p-3 transition-all hover:shadow-[0_4px_14px_rgba(255,217,61,0.1)] focus-visible:ring-2 focus-visible:outline-none lg:hidden"
            style="background: linear-gradient(135deg, rgb(255 217 61 / 8%), rgb(0 180 216 / 6%))"
            role="button"
            tabindex="0"
            :aria-label="t('travel.jumpToIdeas')"
            @click="scrollToIdeas"
            @keydown.enter.prevent="scrollToIdeas"
            @keydown.space.prevent="scrollToIdeas"
          >
            <span class="text-2xl">🌟</span>
            <div class="font-outfit flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ selectedVacation.ideas.length }} {{ t('travel.ideasTeaser').toLowerCase() }}
              <span class="mt-0.5 block text-[0.6875rem] font-normal text-gray-400">
                {{ t('travel.ideasTeaserHint') }}
              </span>
            </div>
            <span class="text-sm text-gray-300">↓</span>
          </div>

          <!-- Timeline header -->
          <div class="mb-4 flex items-center gap-1.5">
            <span class="font-outfit text-sm font-bold text-gray-900 dark:text-gray-100">
              📅 {{ t('travel.timeline') }}
            </span>
          </div>

          <!-- Visual timeline -->
          <div class="relative space-y-2 pl-10">
            <!-- Vertical line -->
            <div
              class="absolute top-0 bottom-0 left-[15px] w-0.5 rounded-full"
              style="background: linear-gradient(180deg, #00b4d8, rgb(0 180 216 / 30%))"
            />

            <!-- Keyed by CONTENT, not by index. The timeline is re-sorted whenever a date
                 changes, and an index key makes Vue reuse the DOM of whatever previously sat
                 at that position — carrying over collapsed state and in-flight inline edits
                 to a different booking. -->
            <template
              v-for="entry in mergedTimeline"
              :key="entry.type === 'group' ? `g:${entry.data.date}` : `gap:${entry.date}`"
            >
              <!-- ── Gap warning (inline at correct date) ── -->
              <template v-if="entry.type === 'gap'">
                <!-- Date header suppressed when a date-group exists for the
                     same date — the group's header already names the date
                     (and on today, that includes the synthetic empty group
                     injected for free-rest days), so the gap card can stand
                     alone here. Past-day muting matches the date-group's
                     treatment so the past/today boundary lands at one
                     consistent place on the timeline. -->
                <div
                  v-if="!groupDates.has(entry.date)"
                  class="relative flex items-center pt-3 pb-1"
                >
                  <!-- Gap circle. Today/future use the dashed orange warning
                       style ("you need to book this"). Past gaps fall back to
                       the regular solid-teal date-circle so the past-day rail
                       rhythm reads uniformly — the 🏨 emoji + the gap card
                       below still convey "no accommodation that night". -->
                  <div
                    :class="[
                      'absolute -left-10 z-[2] flex h-8 w-8 items-center justify-center rounded-full border-[2.5px] bg-white text-xs dark:bg-slate-800',
                      classifyTripDay(entry.date, todayISO) === 'past'
                        ? 'border-[#00B4D8] shadow-[0_2px_8px_rgba(0,180,216,0.12)]'
                        : 'border-dashed border-[var(--heritage-orange)]',
                    ]"
                  >
                    🏨
                  </div>
                  <span
                    class="font-outfit text-[0.8125rem] font-bold text-[var(--heritage-orange)]"
                  >
                    {{ entry.label }}
                  </span>
                </div>
                <div class="relative mb-2">
                  <div
                    class="absolute top-4 -left-[33px] z-[2] h-2 w-2 rounded-full bg-[var(--heritage-orange)] opacity-25"
                  />
                  <div
                    class="absolute top-[18px] -left-[25px] z-[1] h-0.5 w-[18px] bg-[rgba(241,93,34,0.12)]"
                  />
                  <button
                    class="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-[rgba(241,93,34,0.2)] bg-[var(--tint-orange-8)] px-4 py-3 text-left transition-colors hover:bg-[var(--tint-orange-15)] dark:bg-orange-900/10"
                    @click="addSegmentViaWizard(3)"
                  >
                    <div class="flex-1">
                      <span class="font-outfit text-xs font-semibold text-[var(--heritage-orange)]">
                        {{ t('travel.accommodationGap') }}
                      </span>
                    </div>
                    <span class="font-outfit text-[0.625rem] font-semibold text-[#00B4D8]">
                      {{ t('travel.addSegment') }}
                    </span>
                  </button>
                </div>
              </template>

              <!-- ── Date group with segment cards ── -->
              <template v-else>
                <!-- Past days now read via a subtle grey ✓ rail dot + "done" tag
                     (Option B1) instead of a fade — the segment text stays at
                     full contrast. Today's emphasis comes from the inline
                     <TodayTimelineMarker> chip + the orange connector dots. -->
                <div>
                  <!-- Date header — consistent for every day. Past: grey ✓ circle
                       + muted label + "done" pill. Today: Heritage-Orange halo
                       ("you are here"). Future: teal 📅. -->
                  <div class="relative flex items-center pt-3 pb-1">
                    <div
                      :class="[
                        'absolute -left-10 z-[2] flex h-8 w-8 items-center justify-center rounded-full border-[2.5px] bg-white text-xs dark:bg-slate-800',
                        classifyTripDay(entry.data.date, todayISO) === 'today'
                          ? 'today-date-circle'
                          : classifyTripDay(entry.data.date, todayISO) === 'past'
                            ? 'border-[#9aa9b5] text-[#9aa9b5]'
                            : 'border-[#00B4D8] shadow-[0_2px_8px_rgba(0,180,216,0.12)]',
                      ]"
                    >
                      <span aria-hidden="true">{{
                        classifyTripDay(entry.data.date, todayISO) === 'past' ? '✓' : '📅'
                      }}</span>
                    </div>
                    <span
                      class="font-outfit flex items-baseline gap-1.5 text-[0.8125rem] font-bold"
                      :class="
                        classifyTripDay(entry.data.date, todayISO) === 'past'
                          ? 'text-[var(--color-text-muted)]'
                          : 'text-gray-900 dark:text-gray-100'
                      "
                    >
                      <span
                        v-if="
                          selectedVacation.startDate &&
                          tripDayNumber(entry.data.date, selectedVacation.startDate) !== null
                        "
                        class="font-outfit text-[0.625rem] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase"
                      >
                        {{ t('travel.today.dayPrefix') }}
                        {{ tripDayNumber(entry.data.date, selectedVacation.startDate) }}
                        ·
                      </span>
                      {{ entry.data.label }}
                      <span
                        v-if="classifyTripDay(entry.data.date, todayISO) === 'past'"
                        class="font-outfit ml-1 rounded-full bg-[var(--tint-success-10)] px-2 py-0.5 text-[0.625rem] font-semibold text-green-700 dark:text-green-400"
                      >
                        {{ t('travel.timeline.done') }}
                      </span>
                    </span>
                  </div>

                  <!-- "You are here" chip — subordinate to the date header,
                       sits above today's segments (or alone, on a free-rest
                       day with no segments). -->
                  <TodayTimelineMarker
                    v-if="classifyTripDay(entry.data.date, todayISO) === 'today' && todayMarkerInfo"
                    :date="entry.data.date"
                    :day-number="todayMarkerInfo.dayNumber"
                    :total-days="todayMarkerInfo.totalDays"
                    :is-free-day="todayMarkerInfo.isFreeDay"
                  />

                  <!-- Segment cards within this date -->
                  <div v-for="item in entry.data.items" :key="item.id" class="relative mb-2">
                    <!-- Connector dot — Heritage Orange on today's segments AND
                         on an ongoing multi-day span (staying now), teal otherwise. -->
                    <div
                      class="absolute top-4 -left-[33px] z-[2] h-2 w-2 rounded-full"
                      :class="
                        classifyTripDay(entry.data.date, todayISO) === 'today' ||
                        item.timing?.isOngoingSpan
                          ? 'bg-[rgba(241,93,34,0.45)]'
                          : 'bg-[#00B4D8] opacity-25'
                      "
                    />
                    <div
                      class="absolute top-[18px] -left-[25px] z-[1] h-0.5 w-[18px]"
                      :class="
                        classifyTripDay(entry.data.date, todayISO) === 'today' ||
                        item.timing?.isOngoingSpan
                          ? 'bg-[rgba(241,93,34,0.20)]'
                          : 'bg-[rgba(0,180,216,0.12)]'
                      "
                    />

                    <!-- "Staying now" chip for an ongoing stay/cruise/rental —
                         sits above the card so it shows collapsed or expanded. -->
                    <StayingNowChip
                      v-if="item.timing?.isOngoingSpan && item.timing.band.end?.date"
                      :end-date="item.timing.band.end.date"
                    />

                    <TimelineSegmentCard
                      :item="item"
                      :collapsed="isCollapsed(item.id)"
                      :read-only="!canEditActivities"
                      :hint="hintMap.get(item.id)"
                      @inline-save="saveInlineField"
                      @edit="openEditModal"
                      @delete="deleteTimelineItem"
                      @update:collapsed="setCollapsed"
                      @open-attachment="openAttachmentViewer"
                    />
                  </div>
                </div>
              </template>
            </template>
          </div>

          <!-- Add segment to timeline -->
          <div class="mt-4 flex items-center gap-2 pl-10">
            <button
              class="font-outfit inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#00B4D8]/30 bg-[rgba(0,180,216,0.06)] px-4 py-2 text-xs font-semibold text-[#00B4D8] shadow-sm transition-all hover:border-[#00B4D8]/50 hover:bg-[rgba(0,180,216,0.12)]"
              @click="showAddMenu = !showAddMenu"
            >
              {{ showAddMenu ? `✕ ${t('action.close')}` : `+ ${t('travel.addAPlan')}` }}
            </button>
            <Transition
              enter-active-class="transition-all duration-150 ease-out"
              enter-from-class="opacity-0 -translate-x-2"
              leave-active-class="transition-all duration-100 ease-in"
              leave-to-class="opacity-0 -translate-x-2"
            >
              <div v-if="showAddMenu" class="flex flex-wrap gap-1.5">
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(2)"
                >
                  ✈️ {{ t('vacation.step.travel') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(3)"
                >
                  🏨 {{ t('vacation.step.stay') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(4)"
                >
                  🚗 {{ t('vacation.step.gettingAround') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addActivitySegment"
                >
                  🎭 {{ t('vacation.segment.activity') }}
                </button>
              </div>
            </Transition>
          </div>

          <!-- Unbooked items -->
          <div v-if="undatedItems.length > 0" class="mt-4 space-y-2">
            <div
              class="font-outfit text-[0.625rem] font-semibold tracking-wide text-[#B8860B] uppercase"
            >
              🤔 {{ t('vacation.stillDeciding' as any) }}
            </div>
            <TimelineSegmentCard
              v-for="item in undatedItems"
              :key="item.id"
              :item="item"
              :collapsed="isCollapsed(item.id)"
              :read-only="!canEditActivities"
              :hint="hintMap.get(item.id)"
              @inline-save="saveInlineField"
              @edit="openEditModal"
              @delete="deleteTimelineItem"
              @update:collapsed="setCollapsed"
              @open-attachment="openAttachmentViewer"
            />
          </div>
        </div>

        <!-- RIGHT: Ideas panel -->
        <TripIdeasPanel
          ref="ideasPanelRef"
          v-model:quick-idea-text="quickIdeaText"
          :vacation="selectedVacation"
          :unplanned-ideas="unplannedIdeas"
          :planned-ideas="plannedIdeas"
          @add-idea="addQuickIdea"
          @vote="handleVote"
          @edit-idea="openIdeaEdit"
          @delete-idea="handleIdeaDelete"
          @open-list="(id: string) => (linkedListId = id)"
        />
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════
         MODALS
         ═══════════════════════════════════════════════════════════════════════ -->

    <!-- Booking-document lightbox — standard viewer with remove (🗑️). -->
    <PhotoViewer
      :open="viewerOpen"
      :photo-ids="viewerPhotoIds"
      :initial-index="viewerIndex"
      @close="viewerOpen = false"
      @remove="onAttachmentRemove"
    />

    <!-- Vacation wizard -->
    <VacationWizard
      :open="showVacationWizard"
      :vacation="editingVacation"
      :edit-step="editVacationStep"
      @close="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
      @saved="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
    />

    <!-- Segment edit modals -->
    <TravelSegmentEditModal
      :open="editModalType === 'travel'"
      :segment="editingTravelSegment"
      :vacation-id="selectedVacationId ?? ''"
      :segment-index="editingItemIndex"
      @close="closeEditModal"
    />

    <AccommodationEditModal
      :open="editModalType === 'accommodation'"
      :accommodation="editingAccommodation"
      :vacation-id="selectedVacationId ?? ''"
      :accommodation-index="editingItemIndex"
      @close="closeEditModal"
    />

    <TransportationEditModal
      :open="editModalType === 'transportation'"
      :transportation="editingTransportation"
      :vacation-id="selectedVacationId ?? ''"
      :transportation-index="editingItemIndex"
      @close="closeEditModal"
    />

    <!-- Idea edit modal -->
    <IdeaEditModal
      :open="editingIdeaId !== null"
      :idea="editingIdea"
      @close="closeIdeaEdit"
      @save="
        handleIdeaUpdate($event);
        closeIdeaEdit();
      "
      @delete="
        editingIdeaId && handleIdeaDelete(editingIdeaId);
        closeIdeaEdit();
      "
    />

    <!-- Linked Beanie List drawer — opened from the embed, overlays the page (#33) -->
    <ListDetailModal :list-id="linkedListId" @close="linkedListId = null" />

    <!-- Add travel plans from a document (#30): picker, review modal, overlay. The consent
         modal is mounted globally in App.vue (#64). -->
    <AiDocumentPicker
      ref="aiDocPicker"
      @file="(f) => docGrant && void processTravelDoc(f, docGrant)"
    />
    <TravelExtractReviewModal
      :open="reviewReady !== null"
      :ready="reviewReady"
      :submitting="reviewSubmitting"
      @close="reviewReady = null"
      @submit="onReviewSubmit"
    />
    <AiProcessingOverlay :open="isReadingDoc" />

    <!-- Copied toast -->
    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition-all duration-200"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="copied"
        class="font-outfit fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-[var(--color-text)] px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
      >
        {{ t('vacation.copied') }}
      </div>
    </Transition>
  </div>
</template>

<style>
@keyframes hero-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-3px);
  }
}

/* Today's date-circle — Heritage Orange border + halo + pulse so today
   reads as "live" / "you are here" without changing shape, size, or
   the 📅 icon that every other date-circle on the rail uses.
   border-color lives here (not as a Tailwind arbitrary utility) because
   `border-[var(--heritage-orange)]` parses ambiguously next to
   `border-[2.5px]` in Tailwind 4 — the var() form silently falls back
   to currentColor (≈ black). Hex literals inside the keyframe because
   browsers don't reliably interpolate CSS vars across @keyframe steps.
   Heritage Orange = #F15D22. Static fallback for prefers-reduced-motion
   users keeps a visible still ring instead of the pulse. */
.today-date-circle {
  border-color: var(--heritage-orange, #f15d22);
  box-shadow:
    0 2px 8px rgb(241 93 34 / 18%),
    0 0 0 2px rgb(241 93 34 / 18%);
}

@keyframes today-date-circle-pulse {
  0%,
  100% {
    box-shadow:
      0 2px 8px rgb(241 93 34 / 18%),
      0 0 0 0 rgb(241 93 34 / 50%);
  }

  50% {
    box-shadow:
      0 2px 8px rgb(241 93 34 / 18%),
      0 0 0 8px rgb(241 93 34 / 0%);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .today-date-circle {
    animation: today-date-circle-pulse 2s ease-in-out infinite;
  }
}
</style>
