const leaf = require('./test-01247.leaf');

test('test-01247', () => {
  const expected = 'test-01247';
  burn(1630);
  expect(leaf.value).toBe(expected);
});
