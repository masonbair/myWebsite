This is the GitHUb Repo for my personal website, masonbair.com.

I am currently developing this site more and I am writing down the tools that I used to deploy it for future use.

I did a lot of stuff inside of AWS to make this all happen.

I firstly set up a ECR (Elastic container registry) to hold my Docker image for the server
Then I set up an ECS (Elastic container service) to run the docker image that I created
Inside of the ECS, I had to configure a few different things to make it work properly.

I had to set up a load balancer (ALB) for the ECS, so I can set up and server HTTPS traffic over port 443. 
The load balancer also needed me to set up a Target Group, which acts as a user in the internet traffic. It essentially is like, hey all internet traffic under this target group are able to access the port (80 and 443), in this case.

The final thing I needed to do is to create a new IAM user in AWS. This user I connected to my Github Actions with specific permisions for managing an image inside of an ECR.

And to get the pipeline all finsihed, I built up a Github actions workflow based on AWS ECS and ECR. This allows for when I make a change to the github repo, it will make a new container and push it to the ECR and then the ECS updates to run off of the newly pushed container.

This is all the steps I have taken to make this websites CI/CD pipeline work.

The next steps I am going to be doing is setting up some AI Agent tools for an MCP, so my coding agent can make changes to my website, commit and push automatically. THis essentially means I can update my website just by using natural langauge. I have no other steps involved. I just have to talk directly to an AI and boom. Website udpated!

# Tools for the MCP
1. List of all my files
2. Read a specific file
3. Write to a specific file
4. Add and commit  my code
5. Push my code to the repo