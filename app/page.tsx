import OutvidsApp from "@/components/OutvidsApp";
import { siteJsonLd } from "@/lib/site";

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }} />
      <OutvidsApp />
    </>
  );
}
