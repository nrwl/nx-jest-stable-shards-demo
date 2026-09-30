const leaf = require('./test-00917.leaf');

test('test-00917', () => {
  const expected = 'test-00917';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
