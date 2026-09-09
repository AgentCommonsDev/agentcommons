import { lazy, Suspense, useState, useEffect } from "react";
import { ArrowUpRight } from "lucide-react";
import { copy } from "../copy";
import { useBillingConfig } from "../lib/billing-config";
import { Button } from "./ui/button";
const Calendar = lazy(() => import("./native-calendar"));
export function DemoCalendar() {
  const config = useBillingConfig();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!config.enabled) return null;
  return (
    <section className="demo-section" id="demo" aria-labelledby="demo-heading">
      <h2 id="demo-heading">{copy.site.saas.demoTitle}</h2>
      {config.cal_com_url ? (
        <>
          <p>{copy.site.saas.demoDescription}</p>
          <div className="demo-actions">
            <Button asChild variant="secondary">
              <a
                href={config.cal_com_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.site.saas.openCalendar}
                <ArrowUpRight size={15} aria-hidden />
              </a>
            </Button>
          </div>
          {mounted && (
            <Suspense
              fallback={<p role="status">{copy.site.saas.calendarLoading}</p>}
            >
              <Calendar url={config.cal_com_url} />
            </Suspense>
          )}
        </>
      ) : (
        <p>{copy.site.saas.calendarUnavailable}</p>
      )}
    </section>
  );
}
