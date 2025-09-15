// ==UserScript==
// @name         MTurk HIT Queue → Webhook
// @namespace    Violentmonkey Scripts
// @version      1.0
// @description  Send every HIT in your MTurk queue to a webhook
// @match        https://worker.mturk.com/tasks*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  "use strict";

  const WEBHOOK_URL = "https://webhook.site/80b9e516-aa1b-4893-98d3-f805e22a358f";
  let seenAssignments = new Set();

  function sendWebhook(hit) {
    const payload = {
      event: "hit_in_queue",
      assignmentId: hit.assignment_id,
      hitId: hit.task_id,
      requester: hit.project?.requester_name,
      title: hit.project?.title,
      reward: hit.project?.monetary_reward?.amount_in_dollars,
      taskUrl: "https://worker.mturk.com" + hit.task_url,
      time: new Date().toISOString(),
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: WEBHOOK_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: () => console.log("✅ Webhook sent:", payload),
      onerror: (err) => console.error("❌ Webhook error:", err),
    });
  }

  function scanQueue() {
    const reactDiv = document.querySelector("div[data-react-class*='TaskQueueTable']");
    if (!reactDiv) return;

    let props;
    try {
      props = JSON.parse(reactDiv.getAttribute("data-react-props"));
    } catch (e) {
      return;
    }

    if (!props.bodyData) return;

    props.bodyData.forEach((hit) => {
      if (!seenAssignments.has(hit.assignment_id)) {
        seenAssignments.add(hit.assignment_id);
        console.log("🎯 New HIT in queue:", hit.project?.title, hit);
        sendWebhook(hit);
      }
    });
  }

  setInterval(scanQueue, 3000);
})();
