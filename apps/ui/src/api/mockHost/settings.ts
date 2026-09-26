// The mock host (mockApi.ts): settings.
import type { NarrationApi, Scope, ScopedSettingField } from '../../types';
import { wireClone, wireSettings } from '../mockFixtures';

export type MockSettings = Record<Scope, Record<string, ScopedSettingField[]>>;

/** The settings bindings. Saving answers with a fresh bootstrap, as the host does. */
export function createSettingsMock(bootstrap: NarrationApi['bootstrap']) {
  const globalSettings = wireSettings();
  const settings: MockSettings = {
    global: globalSettings,
    project: Object.fromEntries(
      Object.entries(globalSettings).map(([tool, fields]) => [
        tool,
        // A field set in Global is inherited from there; one set nowhere keeps the default the host would send.
        fields.map((field) => ({
          ...field,
          value: '',
          isSet: false,
          effectiveValue: field.isSet ? field.value : field.effectiveValue,
          effectiveSource: field.isSet ? 'Global' : field.effectiveSource,
        })),
      ]),
    ),
  };
  const bindings = {
    saveSettings: async (tool, scope, values) => {
      settings[scope][tool] = (settings[scope][tool] || []).map((field) =>
        field.key in values
          ? {
              ...field,
              value: values[field.key] ?? '',
              isSet: values[field.key] !== null,
              // A cleared project field falls back to Global, a cleared Global field to the value the mock started with (its default).
              effectiveValue:
                values[field.key] ??
                (scope === 'project' ? settings.global[tool] : wireSettings()[tool])?.find((item) => item.key === field.key)?.effectiveValue ??
                '',
            }
          : field,
      );
      return bootstrap();
    },
    settingsForScope: async (scope) => wireClone(settings[scope]),
  } satisfies Partial<NarrationApi>;
  return { bindings, settings };
}
