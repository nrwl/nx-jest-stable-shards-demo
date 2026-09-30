const leaf = require('./test-00397.leaf');

test('test-00397', () => {
  const expected = 'test-00397';
  burn(4410);
  expect(leaf.value).toBe(expected);
});
