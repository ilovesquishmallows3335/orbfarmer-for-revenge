// OrbFarmer - Revenge Plugin (no-import version)

const BASE = "https://discord.com/api/v9";

function getToken() {
    return window?.DiscordNative?.fetchToken?.() 
        ?? RevengeLibrary?.tokens?.getToken?.()
        ?? null;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function jitter(ms) {
    return ms + (Math.random() * ms * 0.2) - (ms * 0.1);
}

async function api(method, path, body) {
    const token = getToken();
    const res = await fetch(BASE + path, {
        method,
        headers: {
            "Authorization": token,
            "Content-Type": "application/json",
            "User-Agent": "Discord-Android/228013",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    try { return { status: res.status, json: await res.json() }; }
    catch { return { status: res.status, json: null }; }
}

async function run() {
    console.log("[OrbFarmer] starting");

    const { status, json: quests } = await api("GET", "/users/@me/quests");
    if (status !== 200 || !quests?.length) {
        console.log("[OrbFarmer] no quests or bad token");
        return;
    }

    for (const quest of quests) {
        const id = quest.id;
        const name = quest.config?.messages?.quest_name ?? id;
        const tasks = quest.user_status?.task_progressions ?? {};

        console.log(`[OrbFarmer] quest: ${name}`);

        if (!Object.keys(tasks).length) {
            await api("POST", `/users/@me/quests/${id}`);
            await sleep(1500);
            continue;
        }

        for (const [taskId, prog] of Object.entries(tasks)) {
            if (prog.status === "COMPLETED") continue;

            const target = prog.target_progress ?? 1;
            const current = prog.current_progress ?? 0;
            const needed = Math.max(target - current, 1);

            console.log(`[OrbFarmer] task ${taskId} — sending ${needed} heartbeats`);

            for (let i = 0; i < needed; i++) {
                await api("POST", `/quests/${id}/heartbeat`, {
                    quest_id: id,
                    task_id: taskId,
                });
                await sleep(jitter(5000));
            }
        }

        const claim = await api("POST", `/users/@me/quests/${id}/claim-reward`, {});
        console.log(`[OrbFarmer] claim ${name}: ${claim.status}`);
    }

    console.log("[OrbFarmer] done");
}

export default {
    name: "OrbFarmer",
    description: "Farms discord orbs by faking quest tasks",
    authors: [{ name: "you", id: "0" }],
    version: "1.0.0",
    onLoad() { run(); },
    onUnload() {},
};