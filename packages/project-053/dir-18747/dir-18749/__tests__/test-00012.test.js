const leaf = require('./test-00012.leaf');

test('test-00012', () => {
  const expected = 'test-00012';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
