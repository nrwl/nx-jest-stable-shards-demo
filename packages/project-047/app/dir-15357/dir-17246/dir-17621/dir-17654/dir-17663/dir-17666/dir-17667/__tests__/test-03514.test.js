const leaf = require('./test-03514.leaf');

test('test-03514', () => {
  const expected = 'test-03514';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
