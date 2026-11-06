import { useEffect, useState } from "react";
import { api, cache, type Me } from "./api";
import { CLASSES } from "../shared/schoolOcr";
import { Chevron, LargeHeader, Section, Segmented, Switch } from "./ui";
import { savedTheme, setTheme, setUi, useLook, useUi, type Theme, type Ui } from "./theme";
import { ICON_GROUPS, ICONS, iconUrl, resolveIcon, savedIcon, setIcon, type IconChoice } from "./appIcon";
import { useCachedFetch } from "./useFetch";
import { useDesktop } from "./hooks";
import { BUILT, VERSION } from "./version";
import type { Layout } from "./App";
import { LABELS, TAB_SLOTS, homeOrder, saveHomeOrder, saveTabOrder, tabOrder, type Part } from "./sections";
import { BugIcon, CoffeeIcon, TAB_ICONS } from "./icons";
import { ReportSheet } from "./Report";
import { SqPlaces } from "./SqPlaces";
import { currentSubscription, disableNotifications, enableNotifications } from "./pushState";

type PushState = "unsupported" | "denied" | "off" | "on" | "busy";

export function Settings({ onError, onLogout, layout, onLayout, onOrder }: {
  onError: (e: unknown) => boolean;
  onLogout: () => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  /** an order changed: the home grid or the tab bar redraws */
  onOrder: () => void;
}) {
  const me = useCachedFetch<Me>("me", api.me, onError);
  const desktop = useDesktop();
  const ui = useUi();
  const [cls, setCls] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const myClass = cls ?? me.data?.class ?? null;
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const [push, setPush] = useState<PushState>("busy");
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [watching, setWatching] = useState<boolean | null>(null);
  // One switch for everything: push on this device + background checks of timetable, grades and absence.
  const notifications = push === "on" && (watching ?? me.data?.watching ?? false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setPush("unsupported");
    if (Notification.permission === "denied") return setPush("denied");
    currentSubscription().then((s) => setPush(s ? "on" : "off"));
  }, []);

  async function toggleNotifications(on: boolean) {
    setPush("busy");
    setPushMsg(null);
    try {
      if (on) {
        if ((await enableNotifications()) === "denied") return setPush("denied");
        setWatching(true);
        setPush("on");
      } else {
        await disableNotifications();
        setWatching(false);
        setPush("off");
      }
    } catch (e) {
      onError(e);
      setPush((await currentSubscription().catch(() => null)) ? "on" : "off");
      setPushMsg("Nepodařilo se změnit notifikace.");
    }
  }

  const isIos = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches;

  return (
    <div className="screen">
      <LargeHeader title="Nastavení" />
      <div className="scroll">
        <div className="profile-card stagger">
          {me.data?.hasPhoto ? (
            <img className="avatar" src="/api/me/photo" alt="" />
          ) : (
            <span className="avatar avatar-fallback" aria-hidden="true">
              {(me.data?.name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </span>
          )}
          <div>
            <p className="profile-name">{me.data?.name ?? "Přihlášený student"}</p>
            <p className="profile-meta">{myClass ? `${myClass} · ` : ""}Přihlášeno přes SIS SSAKHK</p>
          </div>
        </div>

        {/* Right under the profile, so a broken screen is two taps from being reported. */}
        <Section footer="Přijde to rovnou autorovi appky.">
          <button className="row more-row tint-report" onClick={() => setReport(true)}>
            <span className="more-icon">
              <BugIcon />
            </span>
            <span className="row-main">
              <span className="row-title">Nahlásit chybu nebo nápad</span>
            </span>
            <Chevron />
          </button>
        </Section>

        <Section>
          <label className="row">
            <span className="row-title">Třída</span>
            <select
              className="select"
              value={myClass ?? ""}
              onChange={async (e) => {
                const next = e.target.value;
                setCls(next);
                try {
                  await api.setClass(next);
                  if (me.data) cache.set("me", { ...me.data, class: next });
                } catch (err) {
                  onError(err);
                  setCls(null);
                }
              }}
            >
              {!myClass && <option value="">Vyber…</option>}
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </Section>

        <Section title="Vzhled" footer={desktop ? undefined : "Plocha: dlaždice na hlavní obrazovce, sekce se z nich otevírají. Lišta: sekce v liště dole."}>
          <div className="row">
            <span className="row-title">Styl</span>
            <Segmented<Ui>
              label="Styl aplikace"
              value={ui}
              onChange={setUi}
              options={[
                { value: "new", label: "Nový" },
                { value: "og", label: "Původní" },
              ]}
            />
          </div>
          <div className="row">
            <span className="row-title">Režim</span>
            <Segmented<Theme>
              label="Režim zobrazení"
              value={theme}
              onChange={(t) => {
                setThemeState(t);
                setTheme(t);
              }}
              options={[
                { value: "system", label: "Auto" },
                { value: "light", label: "Světlý" },
                { value: "dark", label: "Tmavý" },
              ]}
            />
          </div>
          {!desktop && <div className="row">
            <span className="row-title">Navigace</span>
            <Segmented<Layout>
              label="Navigace v aplikaci"
              value={layout}
              onChange={onLayout}
              options={[
                { value: "home", label: "Plocha" },
                { value: "tabs", label: "Lišta" },
              ]}
            />
          </div>}
        </Section>

        <IconSection />

        {desktop ? (
          <OrderSection
            title="Postranní panel"
            footer="Na počítači je všechno v panelu vlevo. Na telefonu si plochu nebo lištu nastavíš zvlášť."
            load={tabOrder}
            save={(o) => (saveTabOrder(o), onOrder())}
          />
        ) : layout === "home" ? (
          <OrderSection
            title="Pořadí na ploše"
            footer={
              ui === "new"
                ? "Rozvrh je vždycky nahoře, první čtyři jsou velké dlaždice, ostatní v seznamu pod nimi."
                : "Rozvrh je vždycky nahoře, ostatní dlaždice jdou pod ním po dvou."
            }
            load={homeOrder}
            save={(o) => (saveHomeOrder(o), onOrder())}
          />
        ) : (
          <OrderSection
            title="V liště"
            footer="Šipkami přesouváš i mezi lištou a Více. Nastavení je vždycky pod Více."
            load={tabOrder}
            save={(o) => (saveTabOrder(o), onOrder())}
            split={TAB_SLOTS}
          />
        )}

        <Section
          title="Notifikace"
          footer={
            push === "unsupported"
              ? isIos && !standalone
                ? "Na iPhonu fungují notifikace jen v aplikaci přidané na plochu (Sdílet → Přidat na plochu)."
                : "Tento prohlížeč push notifikace nepodporuje."
              : push === "denied"
                ? "Notifikace jsou v prohlížeči zakázané. Povol je v nastavení prohlížeče pro tuhle stránku."
                : (pushMsg ??
                  "Přijde ti zpráva, když se ti změní rozvrh (i když ho škola přepíše ve 3 ráno), přibude známka nebo absence. Aby to server mohl hlídat, i když appku nemáš otevřenou, uloží si tvoje přihlášení do SIS zašifrované. Vypnutím nebo odhlášením se smaže.")
          }
        >
          <div className="row">
            <span className="row-title">Rozvrh, známky a absence</span>
            <Switch
              label="Notifikace o změnách rozvrhu, nových známkách a absenci"
              checked={notifications}
              disabled={push === "busy" || push === "unsupported" || push === "denied"}
              onChange={toggleNotifications}
            />
          </div>
          {notifications && (
            <button className="row row-button" onClick={() => api.pushTest().catch(onError)}>
              Poslat zkušební notifikaci
            </button>
          )}
        </Section>

        <StravaSection connected={me.data?.strava ?? false} onError={onError} />

        <SqPlaces />

        <Section title="Soukromí">
          <div className="privacy">
            <p>
              <b>Co ukládáme:</b> z profilu v SIS tvoje jméno, profilovou fotku, školní e-mail, skupiny, volitelné bloky a
              projekty, k tomu třídu, kterou potvrdíš. Slouží k tomu, abychom věděli, kdo aplikaci používá, a pro další
              funkce (třeba změny rozvrhu pro tvoji třídu a skupiny). U zapnutých notifikací adresu pro doručení do tohohle
              zařízení.
            </p>
            <p>
              <b>Heslo:</b> zůstává zašifrované v tomhle zařízení, aby tě aplikace nemusela odhlašovat, když SIS ukončí
              relaci. Do databáze se dostane jen tehdy, když si zapneš notifikace, a to zašifrované.
              Jinak by server nemohl sám zjistit, že ti něco přibylo.
            </p>
            <p>
              <b>Co neukládáme:</b> známky, rozvrh, absenci ani finance (ty ani v tomhle zařízení). U notifikací o známkách si server pamatuje jen krátké
              otisky (hashe), podle kterých pozná, co je nové. Samotné známky z nich nevyčte.
            </p>
            <p>
              Odhlášením se smaže uložené heslo i odběr notifikací.{" "}
              <a href="https://github.com/oondraa/OpenSISAKHK" target="_blank" rel="noreferrer">
                Zdrojový kód je veřejný.
              </a>
            </p>
          </div>
        </Section>

        <Section footer="Appka je zdarma a bez reklam. Když ti šetří nervy, můžeš autorovi koupit kafe.">
          <a className="row more-row tint-support" href="https://ko-fi.com/oondraa" target="_blank" rel="noreferrer">
            <span className="more-icon">
              <CoffeeIcon />
            </span>
            <span className="row-main">
              <span className="row-title">Podpořit na Ko-fi</span>
            </span>
            <Chevron />
          </a>
        </Section>

        <Section>
          <button className="row row-button destructive" onClick={onLogout}>
            Odhlásit se
          </button>
        </Section>

        <p className="list-footer center">
          OpenSISAKHK {VERSION} · sestaveno {BUILT}
          <br />
          studentská aplikace, není spojená se školou
          <br />
          <span className="diag">{layoutInfo()}</span>
        </p>
      </div>
      {report && <ReportSheet onClose={() => setReport(false)} onError={onError} />}
    </div>
  );
}

/** The app icon: every variant from the design, or one that follows the style and light/dark mode. */
function IconSection() {
  useLook(); // "Automaticky" previews whichever icon the style and mode resolve to right now
  const [choice, setChoice] = useState<IconChoice>(savedIcon);
  const pick = (c: IconChoice) => {
    setChoice(c);
    setIcon(c);
  };
  const option = (c: IconChoice, label: string) => {
    const id = c === "auto" ? resolveIcon("auto") : c;
    return (
      <button key={c} className={`icon-option ${id.endsWith("clear") ? "clear" : ""}`} role="radio" aria-checked={choice === c} onClick={() => pick(c)}>
        <img src={iconUrl(id)} alt="" width={56} height={56} />
        <span>{label}</span>
      </button>
    );
  };
  return (
    <Section
      title="Ikona"
      footer="Mění ikonu v prohlížeči a ikonu, kterou dostane appka nově přidaná na plochu. Na už přidanou appku webová aplikace sáhnout nemůže: odeber ji z plochy a přidej znovu."
    >
      <div className="icon-picker" role="radiogroup" aria-label="Ikona aplikace">
        <div className="icon-group">
          <p className="icon-group-title">Podle stylu a režimu</p>
          <div className="icon-row">{option("auto", "Automaticky")}</div>
        </div>
        {ICON_GROUPS.map((g) => (
          <div key={g.title} className="icon-group">
            <p className="icon-group-title">{g.title}</p>
            <div className="icon-row">{g.ids.map((id) => option(id, ICONS[id].label))}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Up/down arrows rather than dragging: precise with a thumb, and works with a screen reader. */
function OrderSection({ title, footer, load, save, split }: {
  title: string;
  footer: string;
  load: () => Part[];
  save: (order: Part[]) => void;
  /** tab bar: the first `split` are in the bar, the rest are listed under "Ve Více" (moving across works the same) */
  split?: number;
}) {
  const [order, setOrder] = useState(load);
  const move = (i: number, by: number) => {
    const next = [...order];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setOrder(next);
    save(next);
  };
  const row = (part: Part, i: number) => (
    <div key={part} className={`row order-row tint-${part}`}>
      <span className="more-icon">{TAB_ICONS[part]}</span>
      <span className="row-title">{LABELS[part]}</span>
      <span className="order-buttons">
        <button aria-label={`${LABELS[part]} výš`} disabled={i === 0} onClick={() => move(i, -1)}>
          <Chevron dir="up" />
        </button>
        <button aria-label={`${LABELS[part]} níž`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
          <Chevron dir="down" />
        </button>
      </span>
    </div>
  );
  if (split === undefined) return <Section title={title} footer={footer}>{order.map(row)}</Section>;
  return (
    <>
      <Section title={title}>{order.slice(0, split).map(row)}</Section>
      <Section title="Ve Více" footer={footer}>{order.slice(split).map((p, i) => row(p, i + split))}</Section>
    </>
  );
}

/** Canteen account (Strava.cz): its login lives only in the encrypted session cookie, like the SIS one. */
function StravaSection({ connected, onError }: { connected: boolean; onError: (e: unknown) => boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [jmeno, setJmeno] = useState("");
  const [heslo, setHeslo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isOn = on ?? connected;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.stravaConnect(jmeno, heslo);
      cache.set("lunch", null); // the timetable and Obědy reload with the new account
      cache.set("canteen", null);
      setOn(true);
      setHeslo("");
    } catch (err) {
      if (!onError(err))
        setMsg((err as Error).message === "strava_bad_credentials" ? "Špatné jméno nebo heslo do Stravy." : "Stravu se nepodařilo propojit.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.stravaDisconnect();
      cache.set("lunch", null);
      cache.set("canteen", null);
      setOn(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Obědy (Strava)"
      footer={
        msg ??
        (isOn
          ? "Obědy objednáváš a měníš v sekci Obědy, v rozvrhu u oběda uvidíš, co máš objednané."
          : "Propoj účet jídelny a budeš objednávat obědy přímo tady. Heslo zůstává jen zašifrované v tomhle zařízení.")
      }
    >
      {isOn ? (
        <>
          <div className="row">
            <span className="row-title">Účet jídelny</span>
            <span className="row-value">Propojeno</span>
          </div>
          <button className="row row-button destructive" disabled={busy} onClick={disconnect}>
            Odpojit Stravu
          </button>
        </>
      ) : (
        <form onSubmit={connect} className="list-form">
          <input placeholder="Uživatel ve Stravě" aria-label="Uživatel ve Stravě" autoComplete="off" autoCapitalize="none" value={jmeno} onChange={(e) => setJmeno(e.target.value)} />
          <input type="password" placeholder="Heslo do Stravy" aria-label="Heslo do Stravy" autoComplete="off" value={heslo} onChange={(e) => setHeslo(e.target.value)} />
          <button className="row row-button" type="submit" disabled={busy || !jmeno || !heslo}>
            {busy ? "Propojuji…" : "Propojit"}
          </button>
        </form>
      )}
    </Section>
  );
}

/** Viewport vs screen and safe-area insets, to tell layout problems on a phone apart (send this line with a screenshot). */
function layoutInfo() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const { paddingTop, paddingBottom } = getComputedStyle(probe);
  probe.remove();
  const mode = matchMedia("(display-mode: standalone)").matches ? "app" : "web";
  return `${mode} · okno ${innerWidth}×${innerHeight} · displej ${screen.width}×${screen.height} · okraje ${parseInt(paddingTop)}/${parseInt(paddingBottom)}`;
}
