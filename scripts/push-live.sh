#!/usr/bin/env bash
# push-live.sh — publish HEAD's tree as the ONLY commit on live.
#
# live is generated output, and each snapshot of it carries the upcoming
# events of its hour (events-data.json, the feeds, the JSON-LD). A growing
# history would keep every title long after its day — the very history the
# archive and status-data.json no longer keep. So live has no history: every
# push replaces the branch with one parentless commit.
#
# HEAD must be this run's one commit on top of the live commit it checked out.
# Sync and deploy run in different concurrency groups, so live can move in
# between: the commit is then rebased onto the new tip first (neither run
# drops the other's files), and the lease makes the force-push fail rather
# than clobber a push that landed meanwhile.
#
# Usage (in a live checkout, after `git commit`): bash scripts/push-live.sh
set -euo pipefail

msg=$(git log -1 --format=%B)
base=$(git rev-parse HEAD~1)
for i in 1 2 3; do
  git fetch -q origin live
  tip=$(git rev-parse FETCH_HEAD)
  if [ "$tip" != "$base" ]; then
    if ! git rebase -q --onto "$tip" "$base"; then
      git rebase --abort || true
      echo "push-live: rebase onto the new live tip failed" >&2
      exit 1
    fi
    base=$tip
  fi
  commit=$(git commit-tree "HEAD^{tree}" -m "$msg")
  if git push -q --force-with-lease="refs/heads/live:$tip" origin "$commit:refs/heads/live"; then
    echo "push-live: live is $commit (one commit, no history)"
    exit 0
  fi
  echo "Retry $i..."
  sleep 5
done
echo "push-live: push failed after 3 retries" >&2
exit 1
