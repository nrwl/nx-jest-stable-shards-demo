const leaf = require('./test-00007.leaf');

test('test-00007', () => {
  const expected: string = 'test-00007';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
