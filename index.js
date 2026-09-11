// OrbFarmer — Revenge Plugin
// place in: /storage/emulated/0/revenge/plugins/OrbFarmer/index.js

import { after, before } from "@revenge-mod/patcher";
import { findByProps, findByName } from "@revenge-mod/metro";
import { React, ReactNative } from "@revenge-mod/metro/common";
import { showToast } from "@revenge-mod/ui/toasts";
import { storage } from "@revenge-mod/storage";

// ── constants ────────────────────────────────────────────────────────────────
const API = "https://discord.com/api/v9";
const PLUGIN_ID = "orb-farmer";

// ── helpers ──────────────────────────────────────────────────────────────────

function getToken() {
    const TokenModule = findByProps("getToken");
    return TokenModule?.getToken?.() ?? null;
}

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

function jitter(base, factor = 0.2) {
    const spread = base * factor;
    return base + (Math.random() * spread * 2) - spread;
}

async function apiCall(method, path, body = null) {
    const token = getToken();
    if (!token) throw new Error("no token found");

    const opts = {
        method,
        headers: {
            "Authorization": token,
            "Content-Type": "application/json",
            "User-Agent": "Discord-Android/228013 (Mobile; Android 13; SM-G998B)",
            "X-Discord-Locale": "en-US",
        },
    };

    if (body) opts.body = JSON.stringify(body);

    const r = await fetch(`${API}${path}`, opts);
    const text = await r.text();

    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    return { status: r.status, json, text };
}

// ── core logic ───────────────────────────────────────────────────────────────

async function fetchQuests() {
    const { status, json } = await apiCall("GET", "/users/@me/quests");
    if (status === 200) return json;
    console.warn(`[OrbFarmer] fetch quests failed: ${status}`);
    return [];
}

async function enrollQuest(questId) {
    const { status } = await apiCall("POST", `/users/@me/quests/${questId}`);
    console.log(`[OrbFarmer] enroll ${questId}: ${status}`);
    return status === 200 || status === 204;
}

async function sendHeartbeat(questId, taskId) {
    const { status, text } = await apiCall("POST", `/quests/${questId}/heartbeat`, {
        quest_id: questId,
        task_id: taskId,
    });
    console.log(`[OrbFarmer] ♥ heartbeat ${taskId}: ${status}`);
    return status;
}

async function completeTask(questId, taskId) {
    const { status, text } = await apiCall(
        "POST",
        `/quests/${questId}/tasks/${taskId}/complete`,
        {}
    );
    console.log(`[OrbFarmer] complete task ${taskId}: ${status} ${text}`);
    return status;
}

async function claimReward(questId) {
    const { status, text } = await apiCall(
        "POST",
        `/users/@me/quests/${questId}/claim-reward`,
        {}
    );
    console.log(`[OrbFarmer] claim ${questId}: ${status} ${text}`);
    return { status, text };
}

async function fakeStreamTask(questId, taskId, target, current) {
    // discord tracks stream progress in minutes
    // each heartbeat = ~1 tick. send enough to fill the bar
    const needed = Math.max(target - current, 1);
    const interval = 5000; // 5s between heartbeats

    showToast(`[OrbFarmer] streaming task... ${needed} ticks needed`);

    for (let i = 0; i < needed; i++) {
        await sendHeartbeat(questId, taskId);
        await sleep(jitter(interval));
    }
}

async function processQuest(quest) {
    const questId   = quest.id;
    const config    = quest.config ?? {};
    const name      = config?.messages?.quest_name ?? questId;
    const userStatus = quest.user_status ?? {};
    const tasks     = userStatus.task_progressions ?? {};

    console.log(`[OrbFarmer] processing: ${name}`);
    showToast(`[OrbFarmer] working on: ${name}`);

    // enroll if needed
    if (!userStatus || Object.keys(userStatus).length === 0) {
        await enrollQuest(questId);
        await sleep(1500);

        const fresh = await fetchQuests();
        const updated = fresh.find(q => q.id === questId);
        if (updated) return processQuest(updated); // retry with fresh data
        return;
    }

    // process each task
    for (const [taskId, prog] of Object.entries(tasks)) {
        const status  = prog.status ?? "UNKNOWN";
        const target  = prog.target_progress ?? 1;
        const current = prog.current_progress ?? 0;
        const meta    = prog.task_metadata ?? {};
        const type    = (meta.type ?? "").toUpperCase();

        console.log(`[OrbFarmer] task ${taskId} | ${current}/${target} | ${type} | ${status}`);

        if (status === "COMPLETED") {
            console.log(`[OrbFarmer] ${taskId} already done`);
            continue;
        }

        if (type.includes("STREAM") || type.includes("WATCH") || type.includes("VIDEO")) {
            await fakeStreamTask(questId, taskId, target, current);
        } else {
            // direct complete attempt
            const code = await completeTask(questId, taskId);
            if (code !== 200 && code !== 204) {
                // fallback: try heartbeating anyway
                console.warn(`[OrbFarmer] direct complete failed (${code}), falling back to heartbeats`);
                await fakeStreamTask(questId, taskId, target, current);
            }
        }

        await sleep(jitter(2000));
    }

    // claim
    const { status, text } = await claimReward(questId);
    showToast(`[OrbFarmer] claim ${name}: ${status}`);
    console.log(`[OrbFarmer] claim result: ${status} ${text}`);
}

async function runFarmer() {
    showToast("[OrbFarmer] starting...");
    console.log("[OrbFarmer] ── run start ──");

    const quests = await fetchQuests();

    if (!quests.length) {
        showToast("[OrbFarmer] no active quests found");
        return;
    }

    console.log(`[OrbFarmer] ${quests.length} quest(s) found`);

    for (const quest of quests) {
        await processQuest(quest);
        await sleep(jitter(3000));
    }

    showToast("[OrbFarmer] done ✓");
    console.log("[OrbFarmer] ── run complete ──");
}

// ── plugin ui (settings panel button) ───────────────────────────────────────

const { View, Text, TouchableOpacity, StyleSheet } = ReactNative;

const styles = StyleSheet.create({
    container: {
        padding: 16,
    },
    btn: {
        backgroundColor: "#5865F2",
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 20,
        alignItems: "center",
        marginBottom: 10,
    },
    btnText: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 15,
    },
    label: {
        color: "#B5BAC1",
        fontSize: 12,
        textAlign: "center",
        marginTop: 4,
    }
});

export function SettingsComponent() {
    const [running, setRunning] = React.useState(false);

    async function handleRun() {
        if (running) return;
        setRunning(true);
        try {
            await runFarmer();
        } catch (e) {
            console.error("[OrbFarmer] error:", e);
            showToast(`[OrbFarmer] error: ${e.message}`);
        } finally {
            setRunning(false);
        }
    }

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.btn} onPress={handleRun} disabled={running}>
                <Text style={styles.btnText}>
                    {running ? "farming..." : "▶ farm orbs now"}
                </Text>
            </TouchableOpacity>
            <Text style={styles.label}>
                checks active quests, fakes tasks, claims rewards
            </Text>
        </View>
    );
}

// ── plugin manifest ──────────────────────────────────────────────────────────

export default {
    name: "OrbFarmer",
    description: "Fakes Discord quest tasks and farms orbs automatically",
    authors: [{ name: "you", id: "0" }],
    version: "1.0.0",

    onLoad() {
        console.log("[OrbFarmer] loaded");
    },

    onUnload() {
        console.log("[OrbFarmer] unloaded");
    },
};