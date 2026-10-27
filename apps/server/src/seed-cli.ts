import { buildApp } from "./app";

/**
 * `npm run seed`: garantiza que exista al menos una campaña con contenido
 * inicial. No borra nada ni duplica si ya hay campañas.
 */
const { app, repository } = await buildApp({ logger: false, seed: true });

const campaigns = repository.listCampaigns();
console.log(
  campaigns.length > 0
    ? `Campañas disponibles: ${campaigns.map((campaign) => campaign.name).join(", ")}`
    : "No hay campañas.",
);

await app.close();
