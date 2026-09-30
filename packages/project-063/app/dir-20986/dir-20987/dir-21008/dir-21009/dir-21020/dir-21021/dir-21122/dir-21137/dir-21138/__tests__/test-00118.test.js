const leaf = require('./test-00118.leaf');

test('test-00118', () => {
  const expected = 'test-00118';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
