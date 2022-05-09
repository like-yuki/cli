#!/usr/bin/env node

if (process?.argv[2]) {
  process.argv.splice(0, 2);
  process.argv.forEach((item) => {
    console.log(item);
  });
} else {
  console.log('like-yuki');
}
export const yuki = () => console.log('yuki');
