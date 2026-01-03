import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React, { useMemo, useState } from "react";
import "./App.css";
import type { ContactId } from "./evolu";
import { evolu, useEvolu } from "./evolu";
import { getInitialLang, persistLang, translations, type Lang } from "./i18n";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "./mnemonic";

type ContactFormState = {
  name: string;
  npub: string;
  lnAddress: string;
  group: string;
};

const makeEmptyForm = (): ContactFormState => ({
  name: "",
  npub: "",
  lnAddress: "",
  group: "",
});

type Route =
  | { kind: "contacts" }
  | { kind: "settings" }
  | { kind: "contactNew" }
  | { kind: "contact"; id: ContactId };

const parseRouteFromHash = (): Route => {
  const hash = globalThis.location?.hash ?? "";
  if (hash === "#") return { kind: "contacts" };
  if (hash === "#settings") return { kind: "settings" };

  if (hash === "#contact/new") return { kind: "contactNew" };

  const contactPrefix = "#contact/";
  if (hash.startsWith(contactPrefix)) {
    const rawId = hash.slice(contactPrefix.length);
    const id = decodeURIComponent(rawId).trim();
    if (id) return { kind: "contact", id: id as ContactId };
  }

  return { kind: "contacts" };
};

const App = () => {
  console.log("App component rendering");
  const { insert, update } = useEvolu();

  const NO_GROUP_FILTER = "__linky_no_group__";

  const [form, setForm] = useState<ContactFormState>(makeEmptyForm());
  const [editingId, setEditingId] = useState<ContactId | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRouteFromHash());
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<ContactId | null>(
    null
  );
  const [isPasteArmed, setIsPasteArmed] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(() => getInitialLang());
  const [owner, setOwner] = useState<Awaited<typeof evolu.appOwner> | null>(
    null
  );

  const t = <K extends keyof typeof translations.cs>(key: K) =>
    translations[lang][key];

  const contactNameCollator = useMemo(
    () =>
      new Intl.Collator(lang, {
        usage: "sort",
        numeric: true,
        sensitivity: "variant",
      }),
    [lang]
  );

  React.useEffect(() => {
    const onHashChange = () => setRoute(parseRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateToContacts = () => {
    window.location.assign("#");
  };

  const navigateToSettings = () => {
    window.location.assign("#settings");
  };

  const navigateToContact = (id: ContactId) => {
    window.location.assign(`#contact/${encodeURIComponent(String(id))}`);
  };

  const navigateToNewContact = () => {
    window.location.assign("#contact/new");
  };

  React.useEffect(() => {
    evolu.appOwner.then(setOwner);
  }, []);

  React.useEffect(() => {
    persistLang(lang);
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }, [lang]);

  React.useEffect(() => {
    if (!pendingDeleteId) return;
    const timeoutId = window.setTimeout(() => {
      setPendingDeleteId(null);
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [pendingDeleteId]);

  React.useEffect(() => {
    if (!isPasteArmed) return;
    const timeoutId = window.setTimeout(() => {
      setIsPasteArmed(false);
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [isPasteArmed]);

  React.useEffect(() => {
    if (!status) return;
    const timeoutId = window.setTimeout(() => {
      setStatus(null);
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  // Query pro všechny aktivní kontakty
  const contactsQuery = useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("contact")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue)
          .orderBy("createdAt", "desc")
      ),
    []
  );

  const contacts = useQuery(contactsQuery);

  const { groupNames, ungroupedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let ungrouped = 0;

    for (const contact of contacts) {
      const raw = (contact.groupName ?? null) as unknown as string | null;
      const normalized = (raw ?? "").trim();
      if (!normalized) {
        ungrouped += 1;
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    const names = Array.from(counts.entries())
      .sort((a, b) => {
        // First: larger groups first
        if (b[1] !== a[1]) return b[1] - a[1];
        // Tie-breaker: alphabetical
        return a[0].localeCompare(b[0]);
      })
      .map(([name]) => name);

    return { groupNames: names, ungroupedCount: ungrouped };
  }, [contacts]);

  React.useEffect(() => {
    if (!activeGroup) return;
    if (activeGroup === NO_GROUP_FILTER) return;
    if (!groupNames.includes(activeGroup)) setActiveGroup(null);
  }, [activeGroup, groupNames]);

  const visibleContacts = useMemo(() => {
    const filtered = (() => {
      if (!activeGroup) return contacts;
      if (activeGroup === NO_GROUP_FILTER) {
        return contacts.filter((contact) => {
          const raw = (contact.groupName ?? null) as unknown as string | null;
          return !(raw ?? "").trim();
        });
      }
      return contacts.filter((contact) => {
        const raw = (contact.groupName ?? null) as unknown as string | null;
        return (raw ?? "").trim() === activeGroup;
      });
    })();

    return [...filtered].sort((a, b) =>
      contactNameCollator.compare(String(a.name ?? ""), String(b.name ?? ""))
    );
  }, [activeGroup, contactNameCollator, contacts]);

  const selectedContact = useMemo(() => {
    if (route.kind !== "contact") return null;
    return contacts.find((c) => c.id === route.id) ?? null;
  }, [contacts, route]);

  const clearContactForm = () => {
    setForm(makeEmptyForm());
    setEditingId(null);
  };

  const closeContactDetail = () => {
    clearContactForm();
    setPendingDeleteId(null);
    navigateToContacts();
  };

  const openNewContactPage = () => {
    setPendingDeleteId(null);
    setIsPasteArmed(false);
    setEditingId(null);
    setForm(makeEmptyForm());
    navigateToNewContact();
  };

  const toggleSettings = () => {
    if (route.kind === "settings") {
      navigateToContacts();
    } else {
      navigateToSettings();
    }
    setPendingDeleteId(null);
    setIsPasteArmed(false);
  };

  const handleDelete = (id: ContactId) => {
    const result = update("contact", { id, isDeleted: Evolu.sqliteTrue });
    if (result.ok) {
      setStatus(t("contactDeleted"));
      closeContactDetail();
      return;
    }
    setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
  };

  const requestDeleteCurrentContact = () => {
    if (!editingId) return;
    if (pendingDeleteId === editingId) {
      setPendingDeleteId(null);
      handleDelete(editingId);
      return;
    }
    setPendingDeleteId(editingId);
    setStatus(t("deleteArmedHint"));
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setStatus(t("copiedToClipboard"));
    } catch {
      setStatus(t("copyFailed"));
    }
  };

  const applyKeysFromText = async (value: string) => {
    try {
      const mnemonicResult = Evolu.Mnemonic.fromUnknown(value);
      if (!mnemonicResult.ok) {
        setStatus(Evolu.createFormatTypeError()(mnemonicResult.error));
        return;
      }

      const mnemonic = mnemonicResult.value;
      setStatus(t("keysPasting"));
      await evolu.restoreAppOwner(mnemonic, { reload: false });
      try {
        localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, mnemonic);
      } catch {
        // ignore
      }
      globalThis.location.reload();
    } catch (error) {
      setStatus(`${t("errorPrefix")}: ${String(error)}`);
    }
  };

  const pasteKeysFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      setStatus(t("pasteNotAvailable"));
      return;
    }

    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setStatus(t("pasteEmpty"));
        return;
      }
      await applyKeysFromText(text);
    } catch {
      setStatus(t("pasteNotAvailable"));
    }
  };

  const requestPasteKeys = async () => {
    if (isPasteArmed) {
      setIsPasteArmed(false);
      await pasteKeysFromClipboard();
      return;
    }
    setIsPasteArmed(true);
    setStatus(t("pasteArmedHint"));
  };

  const openContactDetail = (contact: (typeof contacts)[number]) => {
    setPendingDeleteId(null);
    setIsPasteArmed(false);

    setEditingId(contact.id);
    setForm({
      name: (contact.name ?? "") as string,
      npub: (contact.npub ?? "") as string,
      lnAddress: (contact.lnAddress ?? "") as string,
      group: ((contact.groupName ?? "") as string) ?? "",
    });

    navigateToContact(contact.id);
  };

  React.useEffect(() => {
    if (route.kind === "contactNew") {
      setPendingDeleteId(null);
      setIsPasteArmed(false);
      setEditingId(null);
      setForm(makeEmptyForm());
      return;
    }

    if (route.kind !== "contact") return;
    setPendingDeleteId(null);
    setIsPasteArmed(false);

    if (selectedContact) {
      setEditingId(selectedContact.id);
      setForm({
        name: (selectedContact.name ?? "") as string,
        npub: (selectedContact.npub ?? "") as string,
        lnAddress: (selectedContact.lnAddress ?? "") as string,
        group: ((selectedContact.groupName ?? "") as string) ?? "",
      });
    } else {
      setEditingId(null);
      setForm(makeEmptyForm());
    }
  }, [route, selectedContact]);

  const handleSaveContact = () => {
    const name = form.name.trim();
    const npub = form.npub.trim();
    const lnAddress = form.lnAddress.trim();
    const group = form.group.trim();

    if (!name && !npub && !lnAddress) {
      setStatus(t("fillAtLeastOne"));
      return;
    }

    const payload = {
      name: name ? (name as typeof Evolu.NonEmptyString1000.Type) : null,
      npub: npub ? (npub as typeof Evolu.NonEmptyString1000.Type) : null,
      lnAddress: lnAddress
        ? (lnAddress as typeof Evolu.NonEmptyString1000.Type)
        : null,
      groupName: group ? (group as typeof Evolu.NonEmptyString1000.Type) : null,
    };

    if (editingId) {
      const result = update("contact", { id: editingId, ...payload });
      if (result.ok) {
        setStatus(t("contactUpdated"));
      } else {
        setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
      }
    } else {
      const result = insert("contact", payload);
      if (result.ok) {
        setStatus(t("contactSaved"));
      } else {
        setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
      }
    }

    if (route.kind === "contact" || route.kind === "contactNew") {
      closeContactDetail();
    } else {
      navigateToContacts();
    }
  };

  const copyMnemonic = async () => {
    if (!owner || !owner.mnemonic) return;
    await navigator.clipboard?.writeText(owner.mnemonic);
    setStatus(t("keysCopied"));
  };

  const showGroupFilter = route.kind === "contacts" && groupNames.length > 0;
  const showNoGroupFilter = ungroupedCount > 0;
  console.log("Rendering with contacts:", contacts.length, "owner:", owner);
  return (
    <div className={showGroupFilter ? "page has-group-filter" : "page"}>
      <header className="hero">
        <div className="hero-content">
          <button className="title-button" onClick={navigateToContacts}>
            {t("appTitle")}
          </button>
          <p className="eyebrow">{t("appTagline")}</p>
        </div>
        <div className="hero-actions">
          <button
            className="ghost gear-button"
            onClick={toggleSettings}
            aria-label={route.kind === "settings" ? t("close") : t("settings")}
            title={route.kind === "settings" ? t("close") : t("settings")}
          >
            <span className="gear-icon">⚙︎</span>
            <span className="gear-label">{t("settings")}</span>
          </button>
        </div>
      </header>

      {route.kind === "settings" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{t("settings")}</p>
              <h2>{t("keys")}</h2>
            </div>
            <div className="badge-box">
              <button
                className="ghost"
                onClick={copyMnemonic}
                disabled={!owner?.mnemonic}
              >
                {t("copyCurrent")}
              </button>
              <button
                className={isPasteArmed ? "danger" : "ghost"}
                onClick={requestPasteKeys}
                aria-label={t("paste")}
                title={isPasteArmed ? t("pasteArmedHint") : t("paste")}
              >
                {t("paste")}
              </button>
            </div>
          </div>

          <div className="panel-header">
            <div>
              <h2>{t("language")}</h2>
            </div>
            <div className="badge-box">
              <button
                className={lang === "cs" ? "" : "secondary"}
                onClick={() => setLang("cs")}
              >
                {t("czech")}
              </button>
              <button
                className={lang === "en" ? "" : "secondary"}
                onClick={() => setLang("en")}
              >
                {t("english")}
              </button>
            </div>
          </div>

          {status && <p className="status">{status}</p>}
        </section>
      )}

      {route.kind === "contact" && (
        <section className="panel">
          <div className="panel-header keep-right">
            <div>
              <p className="eyebrow">{t("contact")}</p>
              <h2>{t("editContact")}</h2>
            </div>
            <button className="ghost" onClick={closeContactDetail}>
              {t("close")}
            </button>
          </div>

          {!selectedContact ? (
            <p className="muted">Kontakt nenalezen.</p>
          ) : null}

          <div className="form-grid">
            <div className="form-col">
              <label>Jméno</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Např. Alice"
              />

              <label>npub</label>
              <input
                value={form.npub}
                onChange={(e) => setForm({ ...form, npub: e.target.value })}
                placeholder="nostr veřejný klíč"
              />

              <label>{t("lightningAddress")}</label>
              <input
                value={form.lnAddress}
                onChange={(e) =>
                  setForm({ ...form, lnAddress: e.target.value })
                }
                placeholder="např. alice@zapsat.cz"
              />

              <label>{t("group")}</label>
              <input
                value={form.group}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
                placeholder="např. Friends"
                list={groupNames.length ? "group-options" : undefined}
              />
              {groupNames.length ? (
                <datalist id="group-options">
                  {groupNames.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
              ) : null}

              <div className="actions">
                <button onClick={handleSaveContact}>
                  {editingId ? t("saveChanges") : t("saveContact")}
                </button>
                <button
                  className={pendingDeleteId === editingId ? "danger" : "ghost"}
                  onClick={requestDeleteCurrentContact}
                  disabled={!editingId}
                  title={
                    pendingDeleteId === editingId
                      ? "Klikněte znovu pro smazání"
                      : t("delete")
                  }
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          </div>

          {status && <p className="status">{status}</p>}
        </section>
      )}

      {route.kind === "contactNew" && (
        <section className="panel">
          <div className="panel-header keep-right">
            <div>
              <p className="eyebrow">{t("contact")}</p>
              <h2>{t("newContact")}</h2>
            </div>
            <button className="ghost" onClick={closeContactDetail}>
              {t("close")}
            </button>
          </div>

          <div className="form-grid">
            <div className="form-col">
              <label>Jméno</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Např. Alice"
              />

              <label>npub</label>
              <input
                value={form.npub}
                onChange={(e) => setForm({ ...form, npub: e.target.value })}
                placeholder="nostr veřejný klíč"
              />

              <label>{t("lightningAddress")}</label>
              <input
                value={form.lnAddress}
                onChange={(e) =>
                  setForm({ ...form, lnAddress: e.target.value })
                }
                placeholder="např. alice@zapsat.cz"
              />

              <label>{t("group")}</label>
              <input
                value={form.group}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
                placeholder="např. Friends"
                list={groupNames.length ? "group-options" : undefined}
              />
              {groupNames.length ? (
                <datalist id="group-options">
                  {groupNames.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
              ) : null}

              <div className="actions">
                <button onClick={handleSaveContact}>{t("saveContact")}</button>
              </div>
            </div>
          </div>

          {status && <p className="status">{status}</p>}
        </section>
      )}

      {route.kind === "contacts" && (
        <>
          <section className="panel">
            <div className="list-header">
              <h3>{t("list")}</h3>

              <button onClick={openNewContactPage}>{t("addContact")}</button>
            </div>
            <div className="contact-list">
              {contacts.length === 0 && (
                <p className="muted">{t("noContactsYet")}</p>
              )}
              {visibleContacts.map((contact) => {
                return (
                  <article
                    key={contact.id}
                    className="contact-card is-clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openContactDetail(contact)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openContactDetail(contact);
                      }
                    }}
                  >
                    <div className="card-header">
                      <div className="card-main">
                        <div className="card-title-row">
                          {contact.name ? <h4>{contact.name}</h4> : null}
                          <div className="contact-badges">
                            {contact.lnAddress ? (
                              <button
                                type="button"
                                className="tag tag-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDeleteId(null);
                                  copyToClipboard(contact.lnAddress!);
                                }}
                                title="Kliknutím zkopírujete lightning adresu"
                              >
                                {contact.lnAddress}
                              </button>
                            ) : null}
                            {contact.npub ? (
                              <button
                                type="button"
                                className="tag tag-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDeleteId(null);
                                  copyToClipboard(contact.npub!);
                                }}
                                title="Kliknutím zkopírujete npub"
                              >
                                {t("npub")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {status && <p className="status">{status}</p>}
          </section>

          {showGroupFilter && (
            <nav className="group-filter-bar" aria-label={t("group")}>
              <div className="group-filter-inner">
                <button
                  type="button"
                  className={
                    activeGroup === null
                      ? "group-filter-btn is-active"
                      : "group-filter-btn"
                  }
                  onClick={() => setActiveGroup(null)}
                >
                  {t("all")}
                </button>
                {showNoGroupFilter ? (
                  <button
                    type="button"
                    className={
                      activeGroup === NO_GROUP_FILTER
                        ? "group-filter-btn is-active"
                        : "group-filter-btn"
                    }
                    onClick={() => setActiveGroup(NO_GROUP_FILTER)}
                  >
                    {t("noGroup")}
                  </button>
                ) : null}
                {groupNames.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={
                      activeGroup === group
                        ? "group-filter-btn is-active"
                        : "group-filter-btn"
                    }
                    onClick={() => setActiveGroup(group)}
                    title={group}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
};

export default App;
