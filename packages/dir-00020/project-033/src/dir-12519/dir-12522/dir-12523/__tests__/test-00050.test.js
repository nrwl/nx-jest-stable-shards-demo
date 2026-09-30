const leaf = require('./test-00050.leaf');

test('test-00050', () => {
  const expected = 'test-00050';
  burn(24975);
  expect(leaf.value).toBe(expected);
});
