const leaf = require('./test-01452.leaf');

test('test-01452', () => {
  const expected = 'test-01452';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
