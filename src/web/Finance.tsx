import { useEffect, useState } from "react";
import { api } from "./api";
import type { Finance as FinanceData, FinanceAccount } from "../worker/parse";
import { Empty, LargeHeader, Section, Segmented, SkeletonList } from "./ui";
import { WalletIcon } from "./icons";

const kc = (n: number) => `${n.toLocaleString("cs-CZ", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} Kč`;
const date = (iso: string) => `${Number(iso.slice(8))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

/**
 * Tuition and the student fund, straight from SIS. Deliberately not cached anywhere (not useCachedFetch, not the
 * service worker, not D1): it loads when the screen opens and is gone when it closes.
 */
export function Finance({ onError }: { onError: (e: unknown) => boolean }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .finance()
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && !onError(e) && setFailed(true));
    return () => {
      stale = true;
    };
  }, []);

  const current = data?.accounts.find((a) => a.id === account) ?? data?.accounts[0];
  return (
    <div className="screen">
      <LargeHeader title="Finance" subtitle="Školné a fond" loading={!data && !failed} />
      <div className="scroll">
        {failed ? (
          <Empty icon={<WalletIcon size={40} />} title="Finance se nepodařilo načíst" text="Zkus to za chvíli znovu." />
        ) : !data ? (
          <SkeletonList count={4} />
        ) : (
          <>
            {data.notice && <p className="banner">{data.notice}</p>}
            <div className="balances stagger">
              {data.accounts.map((a) => (
                <BalanceCard key={a.id} a={a} />
              ))}
            </div>
            <p className="list-footer finance-caveat">
              Přeplatek a nedoplatek počítá SIS a nemusí být přesné: škola finance po výpadku ještě doplňuje
              {data.paymentsAsOf ? ` a platby z banky má načtené jen k ${date(data.paymentsAsOf)}` : ""}. Nedoplatek může být
              i předpis, který ještě není splatný. Když si nejsi jistý, ověř to ve škole.
            </p>

            {data.accounts.length > 1 && (
              <div className="finance-switch">
                <Segmented
                  label="Účet"
                  value={current?.id ?? ""}
                  onChange={setAccount}
                  options={data.accounts.map((a) => ({ value: a.id, label: a.title }))}
                />
              </div>
            )}
            {current?.sections.map((s) => (
              <Section key={s.title} title={s.title} footer={s.total !== null ? `Celkem ${kc(s.total)}` : undefined}>
                {s.rows.length ? (
                  [...s.rows].reverse().map((r, i) => (
                    <div key={i} className="row money-row">
                      <span className="row-main">
                        <span className="row-title">{r.text}</span>
                        <span className="row-sub">{date(r.date)}</span>
                      </span>
                      <span className="money">{kc(r.amount)}</span>
                    </div>
                  ))
                ) : (
                  <div className="row">
                    <span className="row-sub">Nic</span>
                  </div>
                )}
              </Section>
            ))}

            {(data.bankAccount || data.symbols.length > 0) && (
              <Section title="Platba" footer="Ťuknutím zkopíruješ. Platí se převodem z banky, appka nic neplatí.">
                {data.bankAccount && <CopyRow label="Číslo účtu" value={data.bankAccount} />}
                {data.symbols.map((v) => (
                  <CopyRow key={v.label} label={v.label} value={v.value} />
                ))}
              </Section>
            )}
            {data.documents.length > 0 && (
              <Section title="Předpisy">
                {data.documents.map((d) => (
                  <a key={d.url} className="row row-button" href={d.url} target="_blank" rel="noreferrer">
                    {d.label} (PDF)
                  </a>
                ))}
              </Section>
            )}
            <p className="list-footer">Finance se nikam neukládají, ani v tomhle zařízení. Načtou se při každém otevření ze SIS.</p>
          </>
        )}
      </div>
    </div>
  );
}

function BalanceCard({ a }: { a: FinanceAccount }) {
  const b = a.balance;
  return (
    <div className={`balance-card ${b?.kind ?? ""}`}>
      <p className="eyebrow">{a.title}</p>
      <p className="balance-value">{b ? (b.kind === "even" ? "Vyrovnáno" : kc(b.amount)) : "–"}</p>
      <p className="balance-kind">{b ? (b.kind === "overpaid" ? "Přeplatek podle SIS" : b.kind === "underpaid" ? "Nedoplatek podle SIS" : "Vyrovnáno podle SIS") : "Bez údajů"}</p>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="row"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      <span className="row-title">{label}</span>
      <span className="row-value money">{copied ? "Zkopírováno" : value}</span>
    </button>
  );
}
