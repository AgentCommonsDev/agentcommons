import Cal, { getCalApi } from "@calcom/embed-react";
import { useEffect, useMemo } from "react";
import { copy } from "../copy";
const namespace = "agentcommons-demo";
export default function NativeCalendar({ url }: { url: string }) {
  const calendar = useMemo(() => new URL(url), [url]);
  const config = useMemo(
    () => ({
      ...Object.fromEntries(calendar.searchParams),
      layout: "month_view" as const,
      useSlotsViewOnSmallScreen: "true",
      iframeAttrs: { title: copy.saas.calendarTitle },
    }),
    [calendar],
  );
  useEffect(() => {
    let active = true;
    const update = () => {
      void getCalApi({ namespace }).then((api) => {
        if (active)
          api("ui", {
            theme:
              document.documentElement.dataset.theme === "light"
                ? "light"
                : "dark",
          });
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    update();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  return (
    <Cal
      namespace={namespace}
      calOrigin={calendar.origin}
      calLink={calendar.pathname.replace(/^\//, "")}
      config={config}
      className="native-calendar"
    />
  );
}
