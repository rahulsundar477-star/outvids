import { preload } from "react-dom";
import OutvidsApp from "@/components/OutvidsApp";
import { siteJsonLd } from "@/lib/site";

export default function Home() {
  // The first reel can't start until feed.json arrives, so fetch it alongside the JS rather than after it.
  // crossOrigin matches the credentials mode of the app's own fetch(), or the browser downloads it twice.
  preload("/feed.json", { as: "fetch", crossOrigin: "anonymous" });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }} />
      <OutvidsApp />
    </>
  );
}
