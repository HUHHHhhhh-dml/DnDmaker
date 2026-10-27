import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CharacterSheetPage } from "./pages/CharacterSheetPage";
import { CharactersPage } from "./pages/CharactersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EffectEditorPage } from "./pages/EffectEditorPage";
import { EffectsPage } from "./pages/EffectsPage";
import { EncounterEditorPage } from "./pages/EncounterEditorPage";
import { EncountersPage } from "./pages/EncountersPage";
import { ItemEditorPage } from "./pages/ItemEditorPage";
import { ItemsPage } from "./pages/ItemsPage";
import { SkillEditorPage } from "./pages/SkillEditorPage";
import { SkillsPage } from "./pages/SkillsPage";
import { LinkButton, PageHeader } from "./components/ui";

function NotFoundPage() {
  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Error 404"
        title="Ruta perdida"
        description="Esa página no existe. Puede que el enlace esté mal o que el contenido se haya movido."
      />
      <div className="panel p-8 text-center">
        <div className="font-display text-7xl text-ink/10">404</div>
        <p className="mt-2 text-sm text-ink-soft">Volvamos al estudio.</p>
        <div className="mt-5 flex justify-center gap-2">
          <LinkButton to="/" size="sm">Panel de campaña</LinkButton>
          <LinkButton to="/items" variant="ghost" size="sm">Objetos</LinkButton>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="items/new" element={<ItemEditorPage />} />
        <Route path="items/:itemId" element={<ItemEditorPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="skills/new" element={<SkillEditorPage />} />
        <Route path="skills/:skillId" element={<SkillEditorPage />} />
        <Route path="effects" element={<EffectsPage />} />
        <Route path="effects/new" element={<EffectEditorPage />} />
        <Route path="effects/:effectId" element={<EffectEditorPage />} />
        <Route path="characters" element={<CharactersPage />} />
        <Route path="characters/new" element={<CharacterSheetPage />} />
        <Route path="characters/:characterId" element={<CharacterSheetPage />} />
        <Route path="encounters" element={<EncountersPage />} />
        <Route path="encounters/new" element={<EncounterEditorPage />} />
        <Route path="encounters/:encounterId" element={<EncounterEditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
