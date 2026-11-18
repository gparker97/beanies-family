import { describe, expect, it } from 'vitest';
import { useLocationPair } from '@/composables/useLocationPair';

const PLACE = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };

describe('useLocationPair', () => {
  it('binds the pair through one computed and seeds from an entity', () => {
    const pair = useLocationPair('address');
    pair.seed({ address: `${PLACE.name}, room 3`, addressPlace: PLACE });
    expect(pair.value.value).toEqual({ text: `${PLACE.name}, room 3`, place: PLACE });
    pair.value.value = { text: 'Somewhere else' };
    expect(pair.text.value).toBe('Somewhere else');
    expect(pair.place.value).toBeUndefined();
  });

  it('a string-only seed (a prefill) and reset leave no place', () => {
    const pair = useLocationPair('location');
    pair.seed({ location: PLACE.name, locationPlace: PLACE });
    pair.seed({ location: 'Room 3' });
    expect(pair.value.value).toEqual({ text: 'Room 3', place: undefined });
    pair.seed({ location: PLACE.name, locationPlace: PLACE });
    pair.reset();
    expect(pair.value.value).toEqual({ text: '', place: undefined });
  });

  it('patch writes the text as it stands, or the form’s own spelling, an explicit undefined included', () => {
    const pair = useLocationPair('agencyAddress');
    pair.seed({ agencyAddress: `${PLACE.name}, desk 4 `, agencyAddressPlace: PLACE });
    expect(pair.patch()).toEqual({
      agencyAddress: `${PLACE.name}, desk 4 `,
      agencyAddressPlace: PLACE,
    });
    expect(pair.patch(pair.text.value.trim())).toEqual({
      agencyAddress: `${PLACE.name}, desk 4`,
      agencyAddressPlace: PLACE,
    });
    expect(pair.patch(undefined)).toEqual({
      agencyAddress: undefined,
      agencyAddressPlace: undefined,
    });
  });

  it('a place that does not match the text is never written', () => {
    const pair = useLocationPair('location');
    pair.seed({ location: 'Rewritten by an older build', locationPlace: PLACE });
    expect(pair.patch()).toEqual({
      location: 'Rewritten by an older build',
      locationPlace: undefined,
    });
  });
});
