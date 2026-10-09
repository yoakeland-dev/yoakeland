<script lang="ts">
  // The server's audit log (yoakeland internal/audit, SPEC.md §3.1 list_audit): who approved or
  // refused what, what ran, which settings and credentials changed, who connected. Newest first,
  // read a page at a time.
  import { untrack } from "svelte";
  import { app, type ConnectionId } from "../state.svelte";
  import { listAudit, openNotificationTarget } from "../ipc";
  import { AUDIT_CATEGORIES, auditIsRisky, auditKindLabel, describeAudit } from "../audit";
  import type { AuditEvent } from "../types";
  import Icon from "./Icon.svelte";
  import Dropdown from "./Dropdown.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";

  let { cid, connected }: { cid: ConnectionId | null; connected: boolean } = $props();

  const PAGE = 15;
  let events = $state<AuditEvent[]>([]);
  let more = $state(false);
  // Page n starts after cursors[n] (the last seq of page n-1); the server pages by cursor, not offset.
  let cursors = $state<(number | undefined)[]>([undefined]);
  let page = $state(0);
  let loading = $state(false);
  let error = $state("");
  let kinds = $state<string[]>([]);
  let sessionId = $state("");
  let open = $state<number | null>(null);
  // Answers that arrive after the filters changed are someone else's page.
  let generation = 0;

  const server = $derived(cid ? app.servers[cid] : undefined);
  const sessionChoices = $derived.by(() => {
    const all = [...(server?.sessionById.values() ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
    if (sessionId && !all.some((s) => s.sessionId === sessionId)) {
      const picked = server?.sessionById.get(sessionId);
      if (picked) all.push(picked);
    }
    return all;
  });

  async function load(reset: boolean) {
    if (!cid || !connected) return;
    if (reset) {
      cursors = [undefined];
      page = 0;
    }
    const mine = ++generation;
    loading = true;
    error = "";
    try {
      const reply = await listAudit(cid, {
        limit: PAGE,
        before: cursors[page],
        kinds: kinds.length ? kinds : undefined,
        sessionId: sessionId || undefined,
      });
      if (mine !== generation) return;
      if (reply.error) throw new Error(reply.error);
      events = reply.events;
      more = reply.more;
      open = null;
      if (reply.more && reply.events.length) cursors[page + 1] = reply.events[reply.events.length - 1].seq;
    } catch (e) {
      if (mine === generation) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === generation) loading = false;
    }
  }

  function goPage(n: number) {
    page = n;
    void load(false);
  }

  // A new first page whenever the server or a filter changes.
  $effect(() => {
    cid;
    connected;
    kinds;
    sessionId;
    untrack(() => {
      events = [];
      more = false;
      open = null;
      void load(true);
    });
  });

  function setCategory(group: string[], on: boolean) {
    kinds = on ? [...new Set([...kinds, ...group])] : kinds.filter((k) => !group.includes(k));
  }

  function goTo(e: AuditEvent) {
    if (!cid || !e.session) return;
    openNotificationTarget(cid, { sessionId: e.session, projectPath: e.project });
    app.showSettings = false;
  }

  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: "short" });
  const dayLabel = (d: Date) => {
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };
  // Events arrive newest first, so a day is a run of neighbours.
  const days = $derived.by(() => {
    const out: { key: string; label: string; events: AuditEvent[] }[] = [];
    for (const e of events) {
      const d = new Date(e.at);
      const key = d.toDateString();
      if (out[out.length - 1]?.key !== key) out.push({ key, label: dayLabel(d), events: [] });
      out[out.length - 1].events.push(e);
    }
    return out;
  });
  const show = (v: unknown) =>
    Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : typeof v === "boolean" ? (v ? "yes" : "no") : JSON.stringify(v);
  const detailRows = (e: AuditEvent) => Object.entries(e.detail ?? {}).filter(([, v]) => v !== "" && v != null && v !== false);
</script>

<div class="audit">
  <div class="filters">
    <div class="chips" role="group" aria-label="Kinds">
      {#each AUDIT_CATEGORIES as c (c.label)}
        <Chip bind:pressed={() => c.kinds.every((k) => kinds.includes(k)), (v) => setCategory(c.kinds, v)}>{c.label}</Chip>
      {/each}
    </div>
    <div class="row">
      <Dropdown
        items={[{ value: "all", label: "All chats" }, ...sessionChoices.map((s) => ({ value: s.sessionId, label: s.title || "Untitled chat" }))]}
        bind:value={() => sessionId || "all", (v) => (sessionId = v === "all" ? "" : (v ?? ""))}
        triggerTitle="Only events from one chat"
        contentClass="above-modal"
      />
      {#if kinds.length || sessionId}
        <Button type="button" size="sm" variant="ghost" onclick={() => ((kinds = []), (sessionId = ""))}>Clear filters</Button>
      {/if}
      <Button type="button" size="sm" variant="ghost" class="push" disabled={!connected || loading} onclick={() => load(true)}>
        <Icon name="refresh" size={12} /> Refresh
      </Button>
    </div>
  </div>

  {#if error}<p class="error">{error}</p>{/if}

  {#if events.length}
    <div class="table-wrap">
      <table>
        <colgroup><col class="c-time" /><col /><col class="c-kind" /><col class="c-src" /><col class="c-chev" /></colgroup>
        <thead><tr><th>Time</th><th>Event</th><th>Kind</th><th>From</th><th></th></tr></thead>
        <tbody>
          {#each days as day (day.key)}
            <tr class="day"><th colspan="5">{day.label}</th></tr>
            {#each day.events as e (e.seq)}
              {@const expandable = !!e.session || !!(e.detail && Object.keys(e.detail).length)}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
              <tr
                class="ev"
                class:risky={auditIsRisky(e)}
                class:denied={e.outcome === "deny" || e.outcome === "error"}
                class:expandable
                class:open={open === e.seq}
                onclick={() => expandable && (open = open === e.seq ? null : e.seq)}
              >
                <td class="time"><time datetime={e.at}>{clock(e.at)}</time></td>
                <td class="what">
                  <span class="dot"></span>
                  {#if expandable}
                    <button type="button" class="row-btn" aria-expanded={open === e.seq}>{describeAudit(e)}</button>
                  {:else}
                    {describeAudit(e)}
                  {/if}
                </td>
                <td class="kind">{auditKindLabel(e.kind)}</td>
                <td class="src">{e.network ? `${e.actor || "server"} · ${e.network}${e.ip ? ` · ${e.ip}` : ""}` : (e.actor ?? "")}</td>
                <td class="chev">{#if expandable}<Icon name={open === e.seq ? "chevron-up" : "chevron-down"} size={12} />{/if}</td>
              </tr>
              {#if open === e.seq}
                <tr class="more-row">
                  <td></td>
                  <td colspan="4">
                    <div class="detail">
                      {#if detailRows(e).length}
                        <dl>
                          {#each detailRows(e) as [k, v] (k)}
                            <dt>{k}</dt>
                            <dd>{show(v)}</dd>
                          {/each}
                        </dl>
                      {/if}
                      {#if e.session}<Button type="button" size="sm" variant="ghost" onclick={() => goTo(e)}>Open chat</Button>{/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="empty">{loading ? "Loading…" : connected ? "Nothing recorded yet." : "Connect to a server to read its audit log."}</p>
  {/if}
  {#if page > 0 || more}
    <div class="pager">
      <Button type="button" size="sm" variant="ghost" icon disabled={page === 0 || loading} onclick={() => goPage(page - 1)} aria-label="Newer">
        <Icon name="chevron-left" size={13} />
      </Button>
      <span>Page {page + 1}</span>
      <Button type="button" size="sm" variant="ghost" icon disabled={!more || loading} onclick={() => goPage(page + 1)} aria-label="Older">
        <Icon name="chevron-right" size={13} />
      </Button>
    </div>
  {/if}
</div>

<style>
  .audit {
    display: flex;
    flex-direction: column;
    gap: 0.86rem;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.57rem;
  }
  .chips,
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.43rem;
  }
  .row :global(.push) {
    margin-left: auto;
  }
  .table-wrap {
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--text-label-size);
  }
  .c-time {
    width: 4.6rem;
  }
  .c-kind {
    width: 9.5rem;
  }
  .c-src {
    width: 8.5rem;
  }
  .c-chev {
    width: 2rem;
  }
  th {
    padding: 0.43rem 0.71rem;
    text-align: left;
    font-size: 0.66rem;
    font-weight: var(--text-heading-weight);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  thead th {
    border-bottom: 1px solid var(--panel-border);
  }
  tr.day th {
    background: rgba(255, 255, 255, 0.03);
    border-block: 1px solid var(--panel-border);
    color: var(--text);
  }
  tbody tr.day:first-child th {
    border-top: none;
  }
  td {
    padding: 0.5rem 0.71rem;
    vertical-align: top;
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
  tr.ev + tr.ev td,
  tr.ev + tr.more-row td {
    border-top: 1px solid var(--panel-border);
  }
  tr.ev:hover,
  tr.open {
    background: rgba(255, 255, 255, 0.025);
  }
  tr.expandable {
    cursor: pointer;
  }
  .time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  td.what {
    position: relative;
    padding-left: 1.4rem;
    font-size: var(--text-body-size);
    color: var(--text);
  }
  .dot {
    position: absolute;
    left: 0.64rem;
    top: 0.93rem;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
    opacity: 0.45;
  }
  tr.risky .dot {
    background: var(--warning);
    opacity: 1;
  }
  tr.denied .dot {
    background: var(--danger);
    opacity: 1;
  }
  tr.denied .kind {
    color: var(--danger);
  }
  .row-btn {
    all: unset;
    cursor: pointer;
  }
  .row-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .chev {
    text-align: right;
  }
  .more-row td {
    padding-top: 0;
    padding-bottom: 0.71rem;
  }
  .detail {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.86rem;
    padding-left: 0.71rem;
    border-left: 2px solid var(--panel-border);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.14rem 0.86rem;
    min-width: 0;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .pager {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 0.57rem;
    font-size: var(--text-label-size);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .empty {
    margin: 0;
    padding: 0.86rem;
    text-align: center;
    font-size: var(--text-label-size);
    color: var(--text-dim);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
  }
  .error {
    margin: 0;
    font-size: var(--text-label-size);
    color: var(--danger);
  }
</style>
