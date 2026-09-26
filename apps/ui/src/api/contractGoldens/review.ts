// The golden payloads for findings, take review and take comparison: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import { z } from 'zod';
import {
  findingMarkerSchema,
  findingNavigationSchema,
  findingSchema,
  findingsPageSchema,
  findingsSummarySchema,
  reaperStatusSchema,
} from '../schemas/findings';
import { takeComparisonJobSchema, takeReviewCreateTakeResultSchema, takeReviewScanJobSchema } from '../schemas/takeReview';

export const reviewGoldens: Record<string, z.ZodType> = {
  'findings-list-take-review.json': findingsPageSchema,
  'takereview-scan-idle.json': takeReviewScanJobSchema,
  'takereview-scan-running.json': takeReviewScanJobSchema,
  'takereview-scan-success.json': takeReviewScanJobSchema,
  'takereview-scan-cancelled.json': takeReviewScanJobSchema,
  'takereview-scan-error.json': takeReviewScanJobSchema,
  'takereview-create-take.json': takeReviewCreateTakeResultSchema,
  'findings-list-take-comparison.json': findingsPageSchema,
  'takecomparison-idle.json': takeComparisonJobSchema,
  'takecomparison-running.json': takeComparisonJobSchema,
  'takecomparison-success.json': takeComparisonJobSchema,
  'takecomparison-cancelled.json': takeComparisonJobSchema,
  'takecomparison-error.json': takeComparisonJobSchema,
  // compare.py --take-divergence's results file, pinned by its pytest suite and read by the Go host's parser
  // (internal/takecompare), never by the UI: the host turns it into take_comparison evidence, checked above.
  'take-divergence-results.json': z.object({ lines: z.array(z.string()) }),
  'findings-list.json': findingsPageSchema,
  'findings-review.json': findingSchema,
  'findings-summary.json': findingsSummarySchema,
  'findings-reaper-status-looping.json': reaperStatusSchema,
  'findings-reaper-status-not-running.json': reaperStatusSchema,
  'findings-reaper-status-standalone.json': reaperStatusSchema,
  'findings-go-to.json': findingNavigationSchema,
  'findings-go-to-read.json': findingNavigationSchema,
  'findings-loop-read.json': findingNavigationSchema,
  'findings-loop.json': findingNavigationSchema,
  'findings-stop-loop.json': findingNavigationSchema,
  'findings-navigation-stale.json': findingNavigationSchema,
  'findings-navigation-recording.json': findingNavigationSchema,
  'findings-navigation-no-item.json': findingNavigationSchema,
  'findings-navigation-not-running.json': findingNavigationSchema,
  'findings-add-marker.json': findingMarkerSchema,
  'findings-add-marker-existing.json': findingMarkerSchema,
  'findings-add-marker-not-accepted.json': findingMarkerSchema,
  'findings-add-marker-stale.json': findingMarkerSchema,
};
