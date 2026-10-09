// Keep the event target separate from the live PR: a base change can keep both SHAs.
function reviewTarget(pr) {
  return { sha: pr.head?.sha, base: pr.base?.sha, baseRef: pr.base?.ref };
}

function eventTarget(context, env) {
  const target = reviewTarget(context.payload.pull_request ?? {});
  return {
    sha: env.REVIEW_SHA ?? target.sha,
    base: env.REVIEW_BASE_SHA ?? target.base,
    baseRef: env.REVIEW_BASE_REF ?? target.baseRef,
  };
}

function eligibleReview(pr, repo) {
  return (
    pr.state === "open" &&
    !pr.draft &&
    pr.head?.repo?.full_name === `${repo.owner}/${repo.repo}` &&
    [pr.head?.sha, pr.base?.sha, pr.base?.ref].every(
      (value) => typeof value === "string" && value.length > 0,
    )
  );
}

function currentReview(pr, target, repo) {
  return (
    eligibleReview(pr, repo) &&
    pr.head.sha === target.sha &&
    pr.base.sha === target.base &&
    pr.base.ref === target.baseRef
  );
}

function pullNumber(context, env = process.env) {
  const value =
    context.payload.pull_request?.number ??
    env.REVIEW_PR_NUMBER ??
    context.payload.inputs?.pr_number;
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error("Número de PR inválido.");
  return Number(value);
}
module.exports = { pullNumber, reviewTarget, eventTarget, eligibleReview, currentReview };
