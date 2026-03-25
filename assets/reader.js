/**
 * Microsub Reader — client-side JS module
 *
 * Reads configuration from data-* attributes and meta tags:
 *   #timeline[data-channel]             — channel UID (channel view only)
 *   #timeline-loader[data-api-url]      — HTML fragment endpoint
 *   #timeline-loader[data-cursor]       — initial pagination cursor
 *   #timeline-loader[data-show-read]    — show read items flag ("true"/"false")
 *   meta[name="csrf-token"]             — CSRF token
 *   .js-mark-view-read[data-channel]    — mark-view-as-read button (channel view only)
 */

// CSRF token for all AJAX requests
const csrfToken =
  document.querySelector('meta[name="csrf-token"]')?.content || "";

const timeline = document.getElementById("timeline");

if (timeline) {
  // === Keyboard navigation (j / k / o) ===
  // Q17: use a function so newly loaded items are always included
  function getItems() {
    return Array.from(timeline.querySelectorAll(".ms-item-card"));
  }

  let currentIndex = -1;

  function focusItem(index) {
    const items = getItems();
    if (items[currentIndex]) {
      items[currentIndex].classList.remove("ms-item-card--focused");
    }
    currentIndex = Math.max(0, Math.min(index, items.length - 1));
    if (items[currentIndex]) {
      items[currentIndex].classList.add("ms-item-card--focused");
      items[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    const items = getItems();
    switch (e.key) {
      case "j":
        e.preventDefault();
        focusItem(currentIndex + 1);
        break;
      case "k":
        e.preventDefault();
        focusItem(currentIndex - 1);
        break;
      case "o":
      case "Enter":
        e.preventDefault();
        if (items[currentIndex]) {
          const link = items[currentIndex].querySelector(".ms-item-card__link");
          if (link) link.click();
        }
        break;
    }
  });

  // Microsub API URL — strip "/reader" suffix so we hit the protocol endpoint
  const microsubApiUrl = (timeline.dataset.apiBase || location.pathname)
    .replace(/\/reader.*$/, "");

  // === Individual mark-read button ===
  const channelUid = timeline.dataset.channel;

  timeline.addEventListener("click", async (e) => {
    const button = e.target.closest(".ms-item-actions__mark-read");
    if (!button) return;

    e.preventDefault();
    e.stopPropagation();

    const itemId = button.dataset.itemId;
    // In timeline view the channel uid lives on the button; in channel view it's on #timeline
    const effectiveChannel =
      button.dataset.channelUid ||
      button.dataset.channelId ||
      channelUid;
    if (!itemId || !effectiveChannel) return;

    button.disabled = true;

    try {
      const formData = new URLSearchParams();
      formData.append("action", "timeline");
      formData.append("method", "mark_read");
      formData.append("channel", effectiveChannel);
      formData.append("entry", itemId);

      const response = await fetch(microsubApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: formData.toString(),
        credentials: "same-origin",
      });

      if (response.ok) {
        const card = button.closest(".ms-item-card");
        if (card) {
          card.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          card.style.opacity = "0";
          card.style.transform = "translateX(-20px)";
          setTimeout(() => {
            // In timeline view items are wrapped in .ms-timeline-view__item
            const wrapper = card.closest(".ms-timeline-view__item");
            if (wrapper) wrapper.remove();
            else card.remove();
            if (timeline.querySelectorAll(".ms-item-card").length === 0) {
              location.reload();
            }
          }, 300);
        }
      } else {
        console.error("Failed to mark item as read");
        button.disabled = false;
      }
    } catch (error) {
      console.error("Error marking item as read:", error);
      button.disabled = false;
    }
  });

  // === Mark-source-read popover toggle ===
  timeline.addEventListener("click", (e) => {
    const caret = e.target.closest(".ms-item-actions__mark-read-caret");
    if (!caret) return;

    e.preventDefault();
    e.stopPropagation();

    // Close other open popovers
    for (const p of timeline.querySelectorAll(
      ".ms-item-actions__mark-read-popover:not([hidden])",
    )) {
      if (p !== caret.nextElementSibling) p.hidden = true;
    }

    const popover = caret.nextElementSibling;
    if (popover) popover.hidden = !popover.hidden;
  });

  // === Mark-source-read button ===
  timeline.addEventListener("click", async (e) => {
    const button = e.target.closest(".ms-item-actions__mark-source-read");
    if (!button) return;

    e.preventDefault();
    e.stopPropagation();

    const feedId = button.dataset.feedId;
    const effectiveChannel =
      button.dataset.channelUid ||
      button.dataset.channelId ||
      channelUid;
    if (!feedId || !effectiveChannel) return;

    button.disabled = true;

    try {
      const formData = new URLSearchParams();
      formData.append("action", "timeline");
      formData.append("method", "mark_read_source");
      formData.append("channel", effectiveChannel);
      formData.append("feed", feedId);

      const response = await fetch(microsubApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: formData.toString(),
        credentials: "same-origin",
      });

      if (response.ok) {
        const cards = timeline.querySelectorAll(
          `.ms-item-card[data-feed-id="${feedId}"]`,
        );
        for (const card of cards) {
          card.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          card.style.opacity = "0";
          card.style.transform = "translateX(-20px)";
        }
        setTimeout(() => {
          for (const card of [...cards]) {
            const wrapper = card.closest(".ms-timeline-view__item");
            if (wrapper) wrapper.remove();
            else card.remove();
          }
          if (timeline.querySelectorAll(".ms-item-card").length === 0) {
            location.reload();
          }
        }, 300);
      } else {
        button.disabled = false;
      }
    } catch (error) {
      console.error("Error marking source as read:", error);
      button.disabled = false;
    }
  });

  // === Close popovers on outside click ===
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".ms-item-actions__mark-read-group")) {
      for (const p of timeline.querySelectorAll(
        ".ms-item-actions__mark-read-popover:not([hidden])",
      )) {
        p.hidden = true;
      }
    }
  });

  // === Save-for-later ===
  timeline.addEventListener("click", async (e) => {
    const button = e.target.closest(".ms-item-actions__save-later");
    if (!button) return;

    e.preventDefault();
    e.stopPropagation();

    const url = button.dataset.url;
    const title = button.dataset.title;
    if (!url) return;

    button.disabled = true;

    try {
      const response = await fetch("/readlater/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ url, title: title || url, source: "microsub" }),
        credentials: "same-origin",
      });

      if (response.ok) {
        button.classList.add("ms-item-actions__save-later--saved");
        button.title = "Saved";
      } else {
        button.disabled = false;
      }
    } catch {
      button.disabled = false;
    }
  });
}

// === Infinite scroll ===
const loader = document.getElementById("timeline-loader");
if (loader && timeline) {
  const spinner = loader.querySelector(".ms-timeline__spinner");
  const loadMoreLink = loader.querySelector(".ms-timeline__load-more");
  const endMessage = loader.querySelector(".ms-timeline__end");
  let cursor = loader.dataset.cursor;
  let loading = false;
  let hasMore = true;
  const apiUrl = loader.dataset.apiUrl;
  const showReadParam = loader.dataset.showRead;

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    if (spinner) spinner.style.display = "";
    if (loadMoreLink) loadMoreLink.style.display = "none";

    try {
      // Build query: some apiUrls already include a query string (timeline view)
      const sep = apiUrl.includes("?") ? "&" : "?";
      let query = `${sep}after=${encodeURIComponent(cursor)}`;
      if (showReadParam === "true") query += "&showRead=true";

      const response = await fetch(`${apiUrl}${query}`, {
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error("Failed to load");

      const data = await response.json();

      if (data.html && data.count > 0) {
        timeline.insertAdjacentHTML("beforeend", data.html);
      }

      if (data.paging?.after) {
        cursor = data.paging.after;
        if (loadMoreLink) {
          loadMoreLink.href = `?after=${cursor}${showReadParam === "true" ? "&showRead=true" : ""}`;
          loadMoreLink.style.display = "";
        }
      } else {
        hasMore = false;
        if (loadMoreLink) loadMoreLink.style.display = "none";
        if (endMessage) endMessage.style.display = "";
      }
    } catch (error) {
      console.error("Infinite scroll error:", error);
      hasMore = false;
      if (loadMoreLink) loadMoreLink.style.display = "";
    } finally {
      loading = false;
      if (spinner) spinner.style.display = "none";
    }
  }

  // Q16: listen for CustomEvent instead of exposing window global
  document.addEventListener("microsub:trigger-load", () => loadMore());

  // IntersectionObserver auto-loads when sentinel is visible
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        loadMore();
      }
    },
    { rootMargin: "200px" },
  );
  observer.observe(loader);

  // Click handler for fallback link
  if (loadMoreLink) {
    loadMoreLink.addEventListener("click", (e) => {
      e.preventDefault();
      loadMore();
    });
  }
}

// === Mark current view as read (channel view only) ===
const markViewBtn = document.querySelector(".js-mark-view-read");
if (markViewBtn && timeline) {
  // Show the button (hidden by default for noscript compat)
  markViewBtn.style.display = "";

  // Derive Microsub API URL from current path
  const markViewApiUrl = location.pathname.replace(/\/reader.*$/, "");

  markViewBtn.addEventListener("click", async () => {
    const unreadCards = timeline.querySelectorAll(
      ".ms-item-card:not(.ms-item-card--read)",
    );
    const itemIds = [...unreadCards]
      .map((card) => card.dataset.itemId)
      .filter(Boolean);

    if (itemIds.length === 0) return;

    markViewBtn.disabled = true;

    const formData = new URLSearchParams();
    formData.append("action", "timeline");
    formData.append("method", "mark_read");
    formData.append("channel", markViewBtn.dataset.channel);
    for (const id of itemIds) {
      formData.append("entry", id);
    }

    try {
      const response = await fetch(markViewApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body: formData.toString(),
        credentials: "same-origin",
      });

      if (response.ok) {
        for (const card of unreadCards) {
          card.style.transition = "opacity 0.3s ease, transform 0.3s ease";
          card.style.opacity = "0";
          card.style.transform = "translateX(-20px)";
        }
        setTimeout(() => {
          for (const card of [...unreadCards]) card.remove();
          markViewBtn.disabled = false;

          // Q16: dispatch CustomEvent to trigger infinite scroll load
          document.dispatchEvent(new CustomEvent("microsub:trigger-load"));

          if (
            !document.getElementById("timeline-loader") &&
            timeline.querySelectorAll(".ms-item-card").length === 0
          ) {
            location.reload();
          }
        }, 300);
      } else {
        markViewBtn.disabled = false;
      }
    } catch (error) {
      console.error("Error marking current view as read:", error);
      markViewBtn.disabled = false;
    }
  });
}
