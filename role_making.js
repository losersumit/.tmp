
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField
} = require("discord.js");

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const GUILD_ID = "1558597413357363263";

// Colors are taken directly from approved_guilds.embed_color
const VTC_ROLES = [
    { name: "FedEx Logistics", color: 5051532 },
    { name: "Lion Travel & Logistics", color: 15731724 },
    { name: "Mammoet Ferry Transport", color: 16646144 },
    { name: "Apex Transporte", color: 15344928 },
    { name: "North Star Logistics", color: 11307794 },
    { name: "National Command", color: 16753920 },
    { name: "A&Z SPED", color: 5472700 },
    { name: "Anders Sorensen", color: 16777215 },
    { name: "Iron-Haul Supply Chain", color: 8900331 },
    { name: "Beyond Transit", color: 1989258 },
    { name: "Verheire Transport", color: 2247812 },
    { name: "Czymhon Morota Transporte", color: 4948445 },
    { name: "HavenBrug Logistics & Transport", color: 668772 },
    { name: "Nile Trans Logistics", color: 65280 },
    { name: "TmP - eClub", color: 7434239 },
    { name: "Can Bey Logistics", color: 16777215 }
];

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const botMember = await guild.members.fetch(client.user.id);

        if (!botMember.permissions.has(
            PermissionsBitField.Flags.ManageRoles
        )) {
            throw new Error("Missing Manage Roles permission.");
        }

        // Fetch existing roles
        await guild.roles.fetch();

        console.log(`\nCreating VTC roles in ${guild.name}\n`);

        let created = 0;
        let skipped = 0;
        let failed = 0;

        for (const vtc of VTC_ROLES) {
            try {
                const existing = guild.roles.cache.find(
                    role =>
                        role.name.toLowerCase() ===
                        vtc.name.toLowerCase()
                );

                if (existing) {
                    console.log(`[SKIPPED] ${vtc.name} already exists`);
                    skipped++;
                    continue;
                }

                const role = await guild.roles.create({
                    name: vtc.name,
                    color: vtc.color,
                    reason: "UVS TMP VTC identity roles"
                });

                console.log(
                    `[CREATED] ${role.name} | #${vtc.color
                        .toString(16)
                        .padStart(6, "0")
                        .toUpperCase()} | ${role.id}`
                );

                created++;

            } catch (error) {
                console.error(`[FAILED] ${vtc.name}: ${error.message}`);
                failed++;
            }
        }

        console.log("\n========== SUMMARY ==========");
        console.log(`Total VTCs: ${VTC_ROLES.length}`);
        console.log(`Created:    ${created}`);
        console.log(`Skipped:    ${skipped}`);
        console.log(`Failed:     ${failed}`);
        console.log("==============================");

    } catch (error) {
        console.error("Operation failed:", error);
    } finally {
        client.destroy();
    }
});

client.login(process.env.DISCORD_TOKEN);
