const leaf = require('./test-00080.leaf');

test('test-00080', () => {
  const expected = 'test-00080';
  burn(27628);
  expect(leaf.value).toBe(expected);
});
