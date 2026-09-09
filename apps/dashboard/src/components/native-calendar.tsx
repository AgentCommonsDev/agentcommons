import Cal, { getCalApi } from "@calcom/embed-react";
import { useEffect, useMemo } from "react";
import { copy } from "../copy";
import { useTheme } from "../lib/theme";
const namespace = "agentcommons-demo";
export default function NativeCalendar({ url }: { url: string }) {
  const calendar = useMemo(() => new URL(url), [url]);
  const { theme } = useTheme();
  const config = useMemo(
    () => ({
      ...Object.fromEntries(calendar.searchParams),
      layout: "month_view" as const,
      useSlotsViewOnSmallScreen: "true",
      iframeAttrs: { title: copy.site.saas.calendarTitle },
    }),
    [calendar],
  );
  useEffect(() => {
    let active = true;
    void getCalApi({ namespace }).then((api) => {
      if (active)
        api("ui", {
          hideEventTypeDetails: false,
          layout: "month_view",
          theme,
        });
    });
    return () => {
      active = false;
    };
  }, [theme]);
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
