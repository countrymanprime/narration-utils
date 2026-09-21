import { describe, expect, it } from 'vitest';
import { wireSettings } from './mockFixtures';

// The mock stands in for the host, so it may offer only the colour settings the host offers (apps/desktop/app.go,
// fieldSchemas). It once offered seven more, one per entity kind, and the app writes the colour settings it maps (App.tsx)
// inline on <html>, where they beat both theme blocks of styles.css: in the dark theme every capture and every axe pass then
// showed the light hexes of the entity colours, and the dark tokens (ADR 0059) never rendered.
const HOST_COLOUR_FIELDS = ['color_extra', 'color_misread', 'color_note', 'color_skipped'];

describe('the mock settings', () => {
  it('offer only the colour settings the host offers', () => {
    const colourKeys = Object.values(wireSettings())
      .flat()
      .filter((field) => field.kind === 'color')
      .map((field) => field.key)
      .sort();
    expect(colourKeys).toEqual(HOST_COLOUR_FIELDS);
  });
});
