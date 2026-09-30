const leaf = require('./test-00022.leaf');

test('test-00022', () => {
  const expected = 'test-00022';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
