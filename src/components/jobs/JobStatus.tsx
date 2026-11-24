import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { useJobStatus } from "@/components/hooks/useJobStatus";
import { ServerError } from "@/components/auth/ServerError";
import { SubmitButton } from "@/components/auth/SubmitButton";
import type { JobView } from "@/lib/jobs";

interface Props {
  job: JobView;
  // False hides the "Try again" button. The retry route returns to the job check page.
  retry?: boolean;
  // True reloads the page when a job that was in progress at the page load ends.
  reloadOnEnd?: boolean;
}

/** The main line of the status. A running job without a step yet shows "Running". */
function statusText(job: JobView): string {
  switch (job.status) {
    case "waiting":
      return "Waiting for a worker";
    case "running": {
      if (job.stepCount === 0) return "Running";
      const step = `Step ${job.stepIndex} of ${job.stepCount}`;
      return job.stepLabel ? `${step}: ${job.stepLabel}` : step;
    }
    case "done":
      return "Done";
    case "failed":
      return "Failed";
  }
}

function isInProgress(status: JobView["status"]): boolean {
  return status === "waiting" || status === "running";
}

export default function JobStatus({ job: initial, retry = true, reloadOnEnd = false }: Props) {
  const { job, stalled } = useJobStatus(initial.id, initial);
  // Only a job that ends while the page is open reloads the page. A job that ended before the page load does not.
  const reload = reloadOnEnd && isInProgress(initial.status) && !isInProgress(job.status);

  useEffect(() => {
    if (reload) window.location.reload();
  }, [reload]);

  return (
    <div data-testid="job-status" data-status={job.status} className="space-y-3">
      <div role="status" className="space-y-1">
        <p data-testid="job-status-text" className="font-heading text-xl font-extrabold break-words">
          {statusText(job)}
        </p>
        {job.status === "running" && job.attempts > 1 && (
          <p data-testid="job-attempt" className="text-muted-foreground text-sm">
            Attempt {job.attempts} of {job.maxAttempts}
          </p>
        )}
      </div>
      {stalled && (
        <p data-testid="job-stalled" className="text-muted-foreground text-sm">
          The status does not update. Reload the page to try again.
        </p>
      )}
      {job.status === "failed" && (
        <>
          <ServerError message={job.error} />
          {retry && (
            <form method="POST" action={`/api/jobs/${job.id}/retry`}>
              <SubmitButton pendingText="Starting..." icon={<RotateCcw className="size-4" />}>
                Try again
              </SubmitButton>
            </form>
          )}
        </>
      )}
    </div>
  );
}
