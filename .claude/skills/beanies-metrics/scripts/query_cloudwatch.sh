#!/usr/bin/env bash
# beanies-metrics: CloudWatch Logs Insights helpers (READ-ONLY).
#
# The telemetry firehose (/aws/lambda/beanies-family-telemetry-prod) is a
# DIAGNOSTIC stream, not product analytics — but nearly every event carries a
# `family_id`, so it's the best *activity* signal we have (richer than the
# registry's date-only lastLoginAt). All queries filter on t="beanlog".
#
# Usage:
#   query_cloudwatch.sh activity [DAYS]   # distinct active families + event volume + by-surface
#   query_cloudwatch.sh daily [DAYS]      # daily active families (DAU series) per calendar day
#   query_cloudwatch.sh last-seen [DAYS]  # last activity timestamp per family_id
#   query_cloudwatch.sh opens [DAYS]      # app-open count per family_id (surface=open-cycle)
#   query_cloudwatch.sh errors [DAYS]     # error events grouped by surface
# DAYS defaults to 30. Region ap-southeast-1. Retention is 90 days — DAYS>90 is pointless.
#
# Emits the raw Logs Insights result JSON on stdout so the caller can parse it.

set -euo pipefail
export AWS_PAGER=""

REGION="ap-southeast-1"
LOG_GROUP="/aws/lambda/beanies-family-telemetry-prod"
SUB="${1:-activity}"
DAYS="${2:-30}"

case "$SUB" in
  activity)
    Q='fields @timestamp | filter t = "beanlog" | stats count() as events, count_distinct(family_id) as active_families' ;;
  daily)
    # Daily active families (DAU, unit = pods). count_distinct(family_id) per calendar day.
    Q='filter t = "beanlog" and ispresent(family_id) | stats count_distinct(family_id) as dau by bin(1d) as day | sort day asc | limit 120' ;;
  by-surface)
    Q='filter t = "beanlog" | stats count() as events, count_distinct(family_id) as families by surface | sort events desc | limit 40' ;;
  last-seen)
    Q='filter t = "beanlog" and ispresent(family_id) | stats latest(@timestamp) as last_seen, count() as events by family_id | sort last_seen desc | limit 200' ;;
  opens)
    Q='filter t = "beanlog" and surface = "open-cycle" | stats count() as opens, latest(@timestamp) as last_open by family_id | sort opens desc | limit 200' ;;
  errors)
    Q='filter t = "beanlog" and level = "error" | stats count() as errors, count_distinct(family_id) as families by surface | sort errors desc | limit 40' ;;
  *)
    echo "unknown subcommand: $SUB (expected activity|by-surface|last-seen|opens|errors)" >&2; exit 2 ;;
esac

START=$(date -d "${DAYS} days ago" +%s)
END=$(date +%s)

QID=$(aws logs start-query --region "$REGION" \
  --log-group-name "$LOG_GROUP" \
  --start-time "$START" --end-time "$END" \
  --query-string "$Q" --query 'queryId' --output text)

# Poll until the query leaves the Running/Scheduled state.
for _ in $(seq 1 30); do
  STATUS=$(aws logs get-query-results --region "$REGION" --query-id "$QID" --query 'status' --output text)
  if [ "$STATUS" != "Running" ] && [ "$STATUS" != "Scheduled" ]; then break; fi
  sleep 2
done

aws logs get-query-results --region "$REGION" --query-id "$QID" --output json
