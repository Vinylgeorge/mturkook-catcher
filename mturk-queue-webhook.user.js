// ==UserScript==
// @name         MTurk HIT Queue → Webhook
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Send HITs in queue with WorkerID + Time Remaining to webhook.site
// @match        https://www.mturk.com/tasks*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const WEBHOOK_URL = "https://webhook.site/80b9e516-aa1b-4893-98d3-f805e22a358f";

    function sendWebhook(data) {
        GM_xmlhttpRequest({
            method: "POST",
            url: WEBHOOK_URL,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(data)
        });
    }

    function extractHits() {
        const workerIdElem = document.querySelector(".me-bar span.text-uppercase");
        const workerId = workerIdElem ? workerIdElem.innerText.trim() : "Unknown";

        const rows = document.querySelectorAll(".task-queue-header, [data-react-class*='TaskQueueTable']");
        if (!rows.length) return;

        const reactDataElem = document.querySelector("[data-react-class*='TaskQueueTable']");
        if (!reactDataElem) return;

        try {
            const props = JSON.parse(reactDataElem.getAttribute("data-react-props"));
            if (!props.bodyData || !props.bodyData.length) return;

            props.bodyData.forEach(hit => {
                const payload = {
                    event: "hit_accepted",
                    workerId: workerId,
                    requester: hit.project.requester_name,
                    title: hit.project.title,
                    reward: hit.project.monetary_reward.amount_in_dollars,
                    timeRemaining: hit.time_to_deadline_in_seconds,
                    assignmentId: hit.assignment_id,
                    hitId: hit.task_id,
                    acceptedAt: hit.accepted_at
                };
                sendWebhook(payload);
                console.log("Webhook sent:", payload);
            });
        } catch (e) {
            console.error("Failed to parse HIT queue:", e);
        }
    }

    // Run every 10s to detect new HITs
    setInterval(extractHits, 10000);
})();
