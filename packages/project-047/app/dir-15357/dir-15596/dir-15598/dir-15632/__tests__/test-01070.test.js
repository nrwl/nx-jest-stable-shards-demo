const leaf = require('./test-01070.leaf');

test('test-01070', () => {
  const expected = 'test-01070';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
