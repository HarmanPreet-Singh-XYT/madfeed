import type { ComponentType, SVGProps } from "react";
import {
  SiAsana,
  SiClickup,
  SiClaude,
  SiCursor,
  SiDiscord,
  SiG2,
  SiGithub,
  SiGoogle,
  SiGoogleanalytics,
  SiGoogleforms,
  SiGooglemeet,
  SiHelpscout,
  SiHubspot,
  SiIntercom,
  SiJira,
  SiLinear,
  SiMake,
  SiOkta,
  SiProducthunt,
  SiShopify,
  SiSurveymonkey,
  SiTrustpilot,
  SiTypeform,
  SiWordpress,
  SiZapier,
  SiZendesk,
  SiZoom,
} from "react-icons/si";
import {
  TbBrandAzure,
  TbBrandOpenai,
  TbBrandSlack,
  TbBrandTeams,
} from "react-icons/tb";
import { BiLogoMicrosoft } from "react-icons/bi";
import {
  AudioLines,
  Braces,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  Mail,
  MessagesSquare,
  Sparkles,
  Store,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

// Simple Icons removed Salesforce; keep the CC0 mark inline.
function Salesforce(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M10.006 5.415a4.195 4.195 0 013.045-1.306c1.56 0 2.954.9 3.69 2.205.63-.3 1.35-.45 2.1-.45 2.85 0 5.159 2.34 5.159 5.22s-2.31 5.22-5.176 5.22c-.345 0-.69-.044-1.02-.104a3.75 3.75 0 01-3.3 1.95c-.6 0-1.155-.15-1.65-.375A4.314 4.314 0 018.88 20.4a4.302 4.302 0 01-4.05-2.82c-.27.062-.54.076-.825.076-2.204 0-4.005-1.8-4.005-4.05 0-1.5.811-2.805 2.01-3.51-.255-.57-.39-1.2-.39-1.846 0-2.58 2.1-4.65 4.65-4.65 1.53 0 2.85.705 3.72 1.8" />
    </svg>
  );
}

// Brand marks. Simple Icons (CC0) by default; Tabler and Bootstrap Icons (MIT)
// cover the brands Simple Icons has since removed.
const BRANDS: Record<string, Glyph> = {
  slack: TbBrandSlack,
  discord: SiDiscord,
  teams: TbBrandTeams,
  microsoft: BiLogoMicrosoft,
  github: SiGithub,
  linear: SiLinear,
  jira: SiJira,
  clickup: SiClickup,
  asana: SiAsana,
  azuredevops: TbBrandAzure,
  hubspot: SiHubspot,
  salesforce: Salesforce,
  zapier: SiZapier,
  make: SiMake,
  claude: SiClaude,
  openai: TbBrandOpenai,
  cursor: SiCursor,
  google: SiGoogle,
  googlemeet: SiGooglemeet,
  googleforms: SiGoogleforms,
  googleanalytics: SiGoogleanalytics,
  intercom: SiIntercom,
  zendesk: SiZendesk,
  helpscout: SiHelpscout,
  zoom: SiZoom,
  typeform: SiTypeform,
  surveymonkey: SiSurveymonkey,
  g2: SiG2,
  trustpilot: SiTrustpilot,
  producthunt: SiProducthunt,
  okta: SiOkta,
  wordpress: SiWordpress,
  shopify: SiShopify,
};

// A fitting icon for integrations that are a capability rather than a brand.
const ICONS: Record<string, Glyph> = {
  form: ClipboardList,
  chat: MessagesSquare,
  email: Mail,
  recording: AudioLines,
  webhook: Webhook,
  transcript: FileText,
  survey: ClipboardCheck,
  csv: FileSpreadsheet,
  digest: CalendarClock,
  api: Braces,
  lock: LockKeyhole,
  store: Store,
};

// Keyed by the integration name in lib/site-data.ts. Brand names render their
// real logo; clusters render the marks they list; the rest get a matching icon.
const MARKS: Record<string, { logos?: string[]; icon?: string }> = {
  "Website feedback form": { icon: "form" },
  "Website chat": { icon: "chat" },
  Email: { icon: "email" },
  Slack: { logos: ["slack"] },
  "Recordings and transcripts": { icon: "recording" },
  "Any tool that can send a web request": { icon: "webhook" },
  "Call transcripts from other tools": { icon: "transcript" },
  Surveys: { icon: "survey" },
  "GitHub issues": { logos: ["github"] },
  Linear: { logos: ["linear"] },
  "Jira Cloud": { logos: ["jira"] },
  ClickUp: { logos: ["clickup"] },
  Asana: { logos: ["asana"] },
  "Azure DevOps": { logos: ["azuredevops"] },
  "CSV import": { icon: "csv" },
  HubSpot: { logos: ["hubspot"] },
  Salesforce: { logos: ["salesforce"] },
  Webhooks: { icon: "webhook" },
  "Slack, Discord and Microsoft Teams channels": {
    logos: ["slack", "discord", "teams"],
  },
  "Zapier, Make and similar": { logos: ["zapier", "make"] },
  "Weekly team digest": { icon: "digest" },
  "Public API": { icon: "api" },
  "MCP for AI assistants": { logos: ["claude", "openai", "cursor"] },
  "Email and password": { icon: "lock" },
  "Company sign-in (SAML and OIDC providers) and provider buttons": {
    logos: ["google", "microsoft"],
  },
  "Intercom, Zendesk, Help Scout, Freshdesk, Gist": {
    logos: ["intercom", "zendesk", "helpscout"],
  },
  "Gong, Fathom, Fireflies, Grain, tl;dv, Zoom, Google Meet": {
    logos: ["zoom", "googlemeet"],
  },
  "Typeform, Google Forms, SurveyMonkey": {
    logos: ["typeform", "googleforms", "surveymonkey"],
  },
  "Review sites and app stores": {
    logos: ["g2", "trustpilot", "producthunt"],
  },
  "Microsoft Teams and Discord as a place to collect feedback": {
    logos: ["teams", "discord"],
  },
  "Okta, Entra ID, OneLogin, Google Workspace group sync": {
    logos: ["okta", "microsoft", "google"],
  },
  "Segment, Google Analytics, a browser extension": {
    logos: ["googleanalytics"],
  },
  "WordPress and Shopify": { logos: ["wordpress", "shopify"] },
  "Marketplace listings": { icon: "store" },
};

export function IntegrationMark({
  name,
  tone,
  dim,
  className,
}: {
  name: string;
  tone: string;
  dim?: boolean;
  className?: string;
}) {
  const mark = MARKS[name];
  const brands = (mark?.logos ?? [])
    .map((key) => BRANDS[key])
    .filter((glyph): glyph is Glyph => Boolean(glyph))
    .slice(0, 4);
  const Single = brands.length === 1 ? brands[0] : null;
  const Icon = mark?.icon ? (ICONS[mark.icon] ?? Sparkles) : null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl text-on-brand",
        tone,
        dim && "opacity-50",
        className,
      )}
    >
      {Single ? (
        <Single className="size-6" />
      ) : brands.length > 1 ? (
        <span className="grid grid-cols-2 place-items-center gap-1">
          {brands.map((Brand, i) => (
            <Brand key={i} className="size-4" />
          ))}
        </span>
      ) : Icon ? (
        <Icon className="size-5" />
      ) : null}
    </span>
  );
}
