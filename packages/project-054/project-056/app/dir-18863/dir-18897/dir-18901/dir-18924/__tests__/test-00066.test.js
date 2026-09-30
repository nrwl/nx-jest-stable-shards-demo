const leaf = require('./test-00066.leaf');

test('test-00066', () => {
  const expected = 'test-00066';
  burn(41190);
  expect(leaf.value).toBe(expected);
});
