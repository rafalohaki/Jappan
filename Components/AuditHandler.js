const guildList = require("../Managers/Schemas/guildListSchema");
const { EmbedBuilder, PermissionFlagsBits, AuditLogEvent, time } = require("discord.js");
const EventHandler = require("./EventHandler");
const ClientHandler = require("./ClientHandler");
const config = require("../config.json");

class AuditHandler {
	static async auditOn(interaction) {
		let channel = await interaction.options.getChannel("channel");
		let guild = await interaction.guild;
		let perms = guild.members.me
			.permissionsIn(channel)
			.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
		if (perms) {
			await guildList.findOneAndUpdate(
				{ guildId: interaction.guildId },
				{
					$set: {
						auditActive: true,
						auditChannelId: channel.id,
						auditChannelName: channel.name,
						timeStamp: new Date().toISOString(),
					},
				}
			);

			await this.checkAuditStatus(interaction);
			channel.send({
				content: "`Audit log` event's will be sent to this channel from now on :cowboy:",
			});
		} else {
			interaction.editReply(`:no_entry: We dont have enough permissions to post in that channel`);
		}
	}
	static async auditOff(guildId) {
		await guildList.findOneAndUpdate(
			{ guildId: guildId },
			{
				$set: {
					auditActive: false,
					auditChannelId: "",
					auditChannelName: "",
					timeStamp: new Date().toISOString(),
				},
			}
		);
	}
	static async checkAuditStatus(interaction) {
		let rawGuildData = await guildList.findOne({
			guildId: interaction.guildId,
		});
		let memberAnnounceEmbed = new EmbedBuilder()
			.setColor("Blurple")
			.setTitle("Guild Name : " + rawGuildData.guildName)
			.setAuthor({
				name: config.botName + " : Audit Log Status",
				iconURL: config.botpfp,
				url: config.botWebsite,
			});
		if (rawGuildData?.auditActive) {
			let channel = await ClientHandler.getClientChannel(rawGuildData?.auditChannelId);
			memberAnnounceEmbed.addFields(
				{
					name: "Audit Log Feature",
					value: `:green_circle: **ON**`,
				},
				{ name: "Log Channel", value: `${channel}` }
			);
		} else {
			memberAnnounceEmbed.addFields({
				name: "Audit Log  Feature",
				value: `:red_circle: **OFF**`,
			});
		}

		await interaction.editReply({
			embeds: [memberAnnounceEmbed],
		});
	}
	static async getGuildAuditStatus(guildId) {
		let rawGuildData = await guildList.findOne({
			guildId: guildId,
		});
		return rawGuildData?.auditActive;
	}
	static async postAuditEvent(embedObject, guild, extraMessage) {
		let rawGuildData = await guildList.findOne({
			guildId: guild.id,
		});
		if (rawGuildData?.auditActive) {
			let channel = await ClientHandler.getClientChannel(rawGuildData?.auditChannelId);
			if (!channel) {
				let postChannel = await ClientHandler.getClientGuildPostChannel(guild.id, ["general"]);
				if (postChannel) {
					postChannel.send({
						content:
							":warning: The channel `#" +
							rawGuildData?.auditChannelName +
							"` setup for audit log is no longer accessable by the bot and hence the feature was turned off for this server.\nPlease re-enable the audit log feature to continue getting event updates.",
					});
				}
				this.auditOff(guild.id);
				return 0;
			} else {
				channel.send({ content: extraMessage, embeds: [embedObject] });
				return 1;
			}
		}
	}
	static async auditEventVoiceChannel(oldState, newState) {
		let status = await this.getGuildAuditStatus(oldState.guild.id);
		let post = 0;
		if (status) {
			const fetchedLogs = await oldState.guild.fetchAuditLogs({
				limit: 1,
				type: AuditLogEvent.MemberMove,
			});
			const auditEntry = fetchedLogs.entries.find(
				(a) => a.extra.channel.id === oldState.channelId && Date.now() - a.createdTimestamp < 20000
			);
			const executor = auditEntry?.executor ? auditEntry?.executor : "Someone";
			let voiceUser = oldState.member;
			let avatar = voiceUser.user.displayAvatarURL();
			let voiceEmbed = new EmbedBuilder()
				.setAuthor({
					name: voiceUser.user.username + "#" + voiceUser.user.discriminator,
					iconURL: avatar,
				})
				.setTimestamp(new Date())
				.setFooter({ text: "User ID  : " + voiceUser.user.id });
			if (newState.channelId === null && oldState.channelId) {
				let channel = await ClientHandler.getClientChannel(oldState.channelId);
				voiceEmbed
					.setDescription(`${voiceUser}` + " left a Voice Channel")
					.setFields({
						name: "VC",
						value: `${channel}` + " : " + `\`${channel.id}\``,
					})
					.setColor("DarkRed");
				post = 1;
			} else if (oldState.channelId === null && newState.channelId) {
				let channel = await ClientHandler.getClientChannel(newState.channelId);
				voiceEmbed
					.setDescription(`${voiceUser}` + " joined a Voice Channel")
					.setFields({
						name: "VC",
						value: `${channel}` + " : " + `\`${channel.id}\``,
					})
					.setColor("DarkGreen");
				post = 1;
			} else if (oldState.channelId !== newState.channelId) {
				let oldChannel = await ClientHandler.getClientChannel(oldState.channelId);
				let newChannel = await ClientHandler.getClientChannel(newState.channelId);
				voiceEmbed
					.setDescription(`${executor}` + " moved " + `${voiceUser}` + "'s Voice Channel")
					.setFields(
						{
							name: "From VC",
							value: `${oldChannel}` + " : " + `\`${oldChannel.id}\``,
							inline: true,
						},
						{
							name: "To VC",
							value: `${newChannel}` + " : " + `\`${newChannel.id}\``,
							inline: true,
						}
					)
					.setColor("Greyple");
				post = 1;
			} else if (oldState.channelId === newState.channelId) {
				let channel = await ClientHandler.getClientChannel(oldState.channelId);
				let changeString = `${voiceUser}\n`;
				if (oldState.serverDeaf !== newState.serverDeaf) {
					post = 1;
					changeString += newState.serverDeaf
						? "Server Deafen was turned `ON` :mute:\n"
						: "Server Deafen was turned `OFF` :sound:\n";
				}
				if (oldState.serverMute !== newState.serverMute) {
					post = 1;
					changeString += newState.serverMute
						? "Server Mute was turned `ON` :no_entry_sign: :microphone2:\n"
						: "Server Mute was turned `OFF` :microphone2:\n";
				}
				if (oldState.selfDeaf !== newState.selfDeaf) {
					post = 1;
					changeString += newState.selfDeaf
						? "Self Deafen was turned `ON` :mute:\n"
						: "Self Deafen was turned `OFF` :sound:\n";
				}
				if (oldState.selfMute !== newState.selfMute) {
					post = 1;
					changeString += newState.selfMute
						? "Self Mute was turned `ON` :no_entry_sign: :microphone2:\n"
						: "Self Mute was turned `OFF` :microphone2:\n";
				}
				if (oldState.selfVideo !== newState.selfVideo) {
					post = 1;
					changeString += newState.selfVideo
						? "Turned `ON` their Video :camera_with_flash:\n"
						: "Turned `OFF` their Video :camera_with_flash:\n";
				}
				if (oldState.streaming !== newState.streaming) {
					post = 1;
					changeString += newState.streaming ? "`Started` Streaming :computer:\n" : "`Stopped` Streaming :computer:\n";
				}

				voiceEmbed
					.setDescription(changeString)
					.setFields({
						name: "VC",
						value: `${channel}` + " : " + `\`${channel.id}\``,
					})
					.setColor("Yellow");
			}
			if (post === 1) {
				this.postAuditEvent(voiceEmbed, oldState.guild);
			}
		}
	}
	static async auditEventMessageDelete(message) {
		try {
			let status = await this.getGuildAuditStatus(message.guild.id);
			if (status) {
				let timeStamp = Math.floor(message.createdTimestamp / 1000);
				const fetchedLogs = await message.guild.fetchAuditLogs({
					limit: 6,
					type: AuditLogEvent.MessageDelete,
				});
				const auditEntry = fetchedLogs?.entries.find(
					(a) =>
						a?.target?.id === message?.author?.id &&
						a?.extra?.channel?.id === message?.channel?.id &&
						Date.now() - a.createdTimestamp < 20000
				);
				const executor = auditEntry?.executor ? auditEntry?.executor : "Someone";

				let messageContent;
				let messageEmbed;
				let messageDeleteEmbed;
				if (message?.content) {
					messageContent =
						message?.content.length > 1024
							? message?.content.slice(0, 800) + "...\n`CONTENT WAS TRUNCATED`"
							: message?.content;
				} else if (message?.embeds?.length > 0) {
					messageContent = "`A copy of the deleted Embed will be sent along with this Log`";
					messageEmbed = message.embeds[0];
				} else {
					messageContent = "`Discord didn't provide this info`";
				}
				messageDeleteEmbed = new EmbedBuilder()
					.setColor("DarkRed")
					.setDescription("Message Delete Event by " + `**${executor}**`)
					.setTimestamp(new Date())
					.setFields(
						{ name: "Content", value: messageContent },
						{
							name: "Author",
							value: message.author
								? `${message.author}` + " : " + `\`${message.author.id}\``
								: "`Discord didn't provide this info`",
						},
						{
							name: "Channel",
							value: `${message.channel}` + " : " + `\`${message.channel.id}\``,
						},
						{
							name: "Creation Timestamp",
							value: `<t:${timeStamp}:R>`,
						}
					)
					.setFooter({ text: "Message ID  : " + message.id });

				if (message.author) {
					let avatar = message.author.displayAvatarURL();
					messageDeleteEmbed = messageDeleteEmbed.setAuthor({
						name: message.author.username + "#" + message.author.discriminator,
						iconURL: avatar,
					});
				}
				this.postAuditEvent(messageDeleteEmbed, message.guild);
				if (messageEmbed) {
					this.postAuditEvent(messageEmbed, message.guild, "**Follow-Up** : Deleted Message");
				}
			}
		} catch (error) {
			EventHandler.auditEvent("ERROR", "FATAL Error in messageDelete", error);
			EventHandler.auditEvent("DEBUG", "messageDelete Debug Data", message);
		}
	}
	static async auditEventMessageBulkDelete(messages) {
		let status = await this.getGuildAuditStatus(messages.first().guild.id);
		if (status) {
			let timeStamp = Math.floor(Date.now() / 1000);
			const fetchedLogs = await messages.first().guild.fetchAuditLogs({
				limit: 6,
				type: AuditLogEvent.MessageBulkDelete,
			});
			const auditEntry = fetchedLogs.entries.find(
				(a) =>
					a.target.id === messages.first().author.id &&
					a.extra.channel.id === messages.first().channel.id &&
					Date.now() - a.createdTimestamp < 20000
			);
			const executor = auditEntry?.executor ? auditEntry?.executor : "Someone";
			let messageDeleteEmbed = new EmbedBuilder()
				.setColor("DarkRed")
				.setAuthor({
					name: config.botName,
					iconURL: config.botpfp,
					url: config.botWebsite,
				})
				.setDescription("Bulk Message Delete Event by " + `**${executor}**`)
				.setTimestamp(new Date())
				.setFields(
					{ name: "Number of Messages Deleted", value: `${messages.size}` },
					{
						name: "Channel",
						value: `${messages.first().channel}` + " : " + `\`${messages.first().channel.id}\``,
					}
				);
			this.postAuditEvent(messageDeleteEmbed, messages.first().guild);
		}
	}
	static async auditEventMessageUpdate(oldMessage, newMessage) {
		let status = await this.getGuildAuditStatus(oldMessage.guild.id);
		if (status && !oldMessage.flags.has("Loading")) {
			let messageChange = false;
			let oldEmbed = oldMessage.embeds[0];
			let newEmbed = newMessage.embeds[0];
			delete oldEmbed?.data.thumbnail;
			delete newEmbed?.data.thumbnail;
			delete oldEmbed?.data.image;
			delete newEmbed?.data.image;
			oldEmbed = JSON.stringify(oldEmbed);
			newEmbed = JSON.stringify(newEmbed);
			if (oldMessage?.content !== newMessage?.content) {
				messageChange = true;
			}
			if (oldEmbed !== newEmbed) {
				messageChange = true;
			}
			if (messageChange) {
				let oldTimeStamp = Math.floor(newMessage.createdTimestamp / 1000);
				let newTimeStamp = Math.floor(newMessage.editedTimestamp / 1000);
				let oldMessageContent;
				let oldMessageEmbed;
				if (oldMessage?.content) {
					oldMessageContent =
						oldMessage?.content.length > 1024
							? oldMessage?.content.slice(0, 800) + "...\n`CONTENT WAS TRUNCATED`"
							: oldMessage?.content;
				} else {
					oldMessageContent = "`No message content was found but a copy of the Embed will be sent along with this Log`";
					oldMessageEmbed = oldMessage.embeds[0];
					if (!oldMessageEmbed) {
						oldMessageContent = "`Discord didn't provide this info`";
					}
				}
				let newMessageContent;
				let newMessageEmbed;
				let avatar;
				if (newMessage?.content) {
					newMessageContent =
						newMessage?.content.length > 1024
							? newMessage?.content.slice(0, 800) + "...\n`CONTENT WAS TRUNCATED`"
							: newMessage?.content;
				} else {
					newMessageContent = "`No message content was found but a copy of the Embed will be sent along with this Log`";
					newMessageEmbed = newMessage.embeds[0];
					if (!newMessageEmbed) {
						newMessageContent = "`Discord didn't provide this info`";
					}
				}
				avatar = newMessage.author.displayAvatarURL();

				let messageUpdateEmbed = new EmbedBuilder()
					.setColor("DarkRed")
					.setAuthor({
						name: newMessage.author.username + "#" + newMessage.author.discriminator,
						iconURL: avatar,
					})
					.setDescription("A message was updated")
					.setTimestamp(new Date())
					.setFields(
						{ name: "Old Message Content", value: oldMessageContent },
						{ name: "New Message Content", value: newMessageContent },
						{
							name: "Author",
							value: `${newMessage.author}` + " : " + `\`${newMessage.author.id}\``,
						},
						{
							name: "Channel",
							value: `${newMessage.channel}` + " : " + `\`${newMessage.channel.id}\``,
						},
						{
							name: "Creation Timestamp",
							value: oldTimeStamp ? `<t:${oldTimeStamp}:R>` : "`Not provided`",
						},
						{
							name: "Update Timestamp",
							value: newTimeStamp ? `<t:${newTimeStamp}:R>` : "`Not provided`",
						}
					)
					.setFooter({ text: "Message ID  : " + newMessage.id });
				this.postAuditEvent(messageUpdateEmbed, newMessage.guild);
				if (oldMessageEmbed) {
					this.postAuditEvent(oldMessageEmbed, newMessage.guild, "**Follow-Up** : Old Embed");
				}
				if (newMessageEmbed) {
					this.postAuditEvent(newMessageEmbed, newMessage.guild, "**Follow-Up** : New Embed");
				}
			}
		}
	}
	static async auditEventInvite(invite, type) {
		let status = await this.getGuildAuditStatus(invite.guild.id);
		if (status) {
			let inviteEmbed = new EmbedBuilder()
				.setTimestamp()
				.setFields({ name: "Invite Code", value: invite.code }, { name: "Channel", value: `${invite.channel}` });
			if (type === "inviteCreate") {
				let createdTimestamp = Math.floor(invite.createdTimestamp / 1000);
				let expiresTimestamp = invite._expiresTimestamp / 1000;
				let user = await ClientHandler.getClientUser(invite.inviterId);
				let avatar = user.displayAvatarURL();
				inviteEmbed
					.setColor("Aqua")
					.setAuthor({
						name: user.username + "#" + user.discriminator,
						iconURL: avatar,
					})
					.setDescription("A invite was created by " + `${user}`)
					.addFields(
						{
							name: "Create Timestamp",
							value: `<t:${createdTimestamp}:R>`,
						},
						{
							name: "Expire Timestamp",
							value: expiresTimestamp ? `<t:${expiresTimestamp}:R>` : "Never Expires",
						},
						{
							name: "Max number of Uses",
							value: invite.maxUses ? `${invite.maxUses}` : "Unlimited",
						}
					);
			} else if (type === "inviteDelete") {
				inviteEmbed
					.setAuthor({
						name: config.botName,
						iconURL: config.botpfp,
						url: config.botWebsite,
					})
					.setColor("LuminousVividPink")
					.setDescription("A invite was revoked");
			}
			this.postAuditEvent(inviteEmbed, invite.guild);
		}
	}
	static async auditEventGuildMember(oldMember, newMember, type) {
		let status = await this.getGuildAuditStatus(oldMember.guild.id);
		if (status) {
			let avatar = oldMember.user.displayAvatarURL();
			let memberEmbed = new EmbedBuilder()
				.setAuthor({
					name: oldMember.user.username + "#" + oldMember.user.discriminator,
					iconURL: avatar,
				})
				.setFooter({ text: "User ID  : " + oldMember.user.id })
				.setTimestamp();
			if (type === "guildMemberRemove") {
				let roleString = "";
				if (oldMember._roles.length === 0) {
					roleString = "No Roles";
				} else {
					roleString = await Promise.all(
						oldMember._roles.map(async (role) => {
							let currRole = await ClientHandler.getClientGuildRole(oldMember.guild.id, role);
							if (currRole) {
								return `${currRole}`;
							} else {
								return `@${role}`;
							}
						})
					);
					roleString = roleString.join(" ");
				}
				memberEmbed
					.setColor("DarkRed")
					.setDescription(`${oldMember.user}` + " just left " + `**${oldMember.guild.name}**`)
					.addFields({
						name: "Roles Assigned",
						value: `${roleString}`,
					});
			} else if (type === "guildMemberAdd") {
				memberEmbed
					.setColor("Aqua")
					.setDescription(`${oldMember.user}` + " just joined " + `**${oldMember.guild.name}**`);
			} else if (type === "guildMemberUpdate") {
				memberEmbed.setColor("Yellow").setDescription(`${oldMember.user}` + " profile was updated");
				if (oldMember.nickname !== newMember.nickname) {
					memberEmbed.addFields(
						{
							name: "Old Nickname",
							value: oldMember.nickname ? `\`${oldMember.nickname}\`` : `\`${oldMember.user.username}\``,
							inline: true,
						},
						{
							name: "New Nickname",
							value: newMember.nickname ? `\`${newMember.nickname}\`` : `\`${oldMember.user.username}\``,
							inline: true,
						}
					);
				}
				if (oldMember._roles.join("") !== newMember._roles.join("")) {
					let oldRoles = await Promise.all(
						oldMember._roles.map(async (role) => {
							let currRole = await ClientHandler.getClientGuildRole(oldMember.guild.id, role);
							if (currRole) {
								return `${currRole}`;
							} else {
								return `@${role}`;
							}
						})
					);
					oldRoles = oldRoles.join(" ");
					let newRoles = await Promise.all(
						newMember._roles.map(async (role) => {
							let currRole = await ClientHandler.getClientGuildRole(newMember.guild.id, role);
							if (currRole) {
								return `${currRole}`;
							} else {
								return `@${role}`;
							}
						})
					);
					newRoles = newRoles.join(" ");
					if (!oldRoles) {
						oldRoles = "No Roles";
					}
					if (!newRoles) {
						newRoles = "No Roles";
					}
					memberEmbed.addFields(
						{
							name: "Old Roles",
							value: `${oldRoles}`,
						},
						{
							name: "New Roles",
							value: `${newRoles}`,
						}
					);
				}
				if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
					const fetchedLogs = await oldMember.guild.fetchAuditLogs({
						limit: 1,
						type: AuditLogEvent.MemberUpdate,
					});
					const auditEntry = fetchedLogs?.entries?.find(
						(a) => a?.target?.id === oldMember?.user?.id && Date.now() - a.createdTimestamp < 20000
					);
					if (newMember.communicationDisabledUntilTimestamp > oldMember.communicationDisabledUntilTimestamp) {
						let timeStamp = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);
						memberEmbed.addFields(
							{
								name: "Added timeout until",
								value: `<t:${timeStamp}:R>`,
							},
							{
								name: "Action initated by",
								value: `${auditEntry.executor}`,
							}
						);
					} else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
						let timeStamp = Math.floor(oldMember.communicationDisabledUntilTimestamp / 1000);
						memberEmbed.addFields(
							{
								name: "Removed timeout until",
								value: `<t:${timeStamp}:R>`,
							},
							{
								name: "Action initated by",
								value: `${auditEntry.executor}`,
							}
						);
					}
				}
			}
			this.postAuditEvent(memberEmbed, oldMember.guild);
		}
	}
	static async auditEventMemberBan(ban, type) {
		let status = await this.getGuildAuditStatus(ban.guild.id);
		if (status) {
			let avatar = ban.user.displayAvatarURL();
			let banEmbed = new EmbedBuilder()
				.setAuthor({
					name: ban.user.username + "#" + ban.user.discriminator,
					iconURL: avatar,
				})
				.setFooter({ text: "User ID  : " + ban.user.id })
				.setTimestamp();
			if (type === "guildBanAdd") {
				const fetchedLogs = await ban.guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.MemberBanAdd,
				});
				const auditEntry = fetchedLogs?.entries?.find(
					(a) => a?.target?.id === ban?.user?.id && Date.now() - a.createdTimestamp < 20000
				);
				banEmbed.setDescription(`${ban.user}` + " was **BANNED**").addFields(
					{
						name: "Reason",
						value: auditEntry?.reason ? `${auditEntry?.reason}` : "No reason provided",
					},
					{
						name: "Banned by",
						value: auditEntry?.executor ? `${auditEntry?.executor}` : "No Reason",
					}
				);
			} else if (type === "guildBanRemove") {
				const fetchedLogs = await ban.guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.MemberBanRemove,
				});
				const auditEntry = fetchedLogs.entries.find(
					(a) => a.target.id === ban.user.id && Date.now() - a.createdTimestamp < 20000
				);
				banEmbed.setDescription(`${ban.user}` + " was **UN-BANNED**").addFields({
					name: "Un-Banned by",
					value: auditEntry?.executor ? `${auditEntry?.executor}` : "No Reason",
				});
			}
			this.postAuditEvent(banEmbed, ban.guild);
		}
	}
	static async auditEventChannel(oldChannel, newChannel, type) {
		let status = await this.getGuildAuditStatus(oldChannel.guild.id);
		if (status) {
			let channelEmbed = new EmbedBuilder()
				.setAuthor({
					name: config.botName,
					iconURL: config.botpfp,
					url: config.botWebsite,
				})
				.setFooter({ text: "Channel ID  : " + oldChannel.id })
				.setTimestamp();
			let channelType = "Some Channel";
			if (oldChannel.type === 0) {
				channelType = "Text Channel";
			} else if (oldChannel.type === 2) {
				channelType = "Voice Channel";
			} else if (oldChannel.type === 4) {
				channelType = "Category Channel";
			} else if (oldChannel.type === 5) {
				channelType = "Announcement Channel";
			} else if (oldChannel.type === 13) {
				channelType = "Stage Channel";
			} else if (oldChannel.type === 15) {
				channelType = "Forum Channel";
			}
			if (type === "channelCreate") {
				const fetchedLogs = await oldChannel.guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.ChannelCreate,
				});
				const auditEntry = fetchedLogs?.entries?.find(
					(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
				);
				channelEmbed.setColor("DarkGreen").addFields(
					{
						name: `${channelType}` + " was created",
						value: `${oldChannel}`,
					},
					{
						name: "Created by",
						value: auditEntry?.executor ? `${auditEntry?.executor}` : "Someone",
					}
				);
			} else if (type === "channelDelete") {
				const fetchedLogs = await oldChannel.guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.ChannelDelete,
				});
				const auditEntry = fetchedLogs?.entries?.find(
					(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
				);
				channelEmbed.setColor("Red").addFields(
					{
						name: `${channelType}` + " was deleted",
						value: `Name : **${oldChannel.name}**`,
					},
					{
						name: "Deleted by",
						value: auditEntry?.executor ? `${auditEntry?.executor}` : "Someone",
					}
				);
			} else if (type === "channelUpdate") {
				let fetchedLogs = await oldChannel.guild.fetchAuditLogs({
					limit: 1,
					type: AuditLogEvent.ChannelUpdate,
				});
				let auditEntry = fetchedLogs?.entries?.find(
					(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
				);
				if (!auditEntry) {
					fetchedLogs = await oldChannel.guild.fetchAuditLogs({
						limit: 1,
						type: AuditLogEvent.ChannelOverwriteCreate,
					});
					auditEntry = fetchedLogs?.entries?.find(
						(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
					);
				}
				if (!auditEntry) {
					fetchedLogs = await oldChannel.guild.fetchAuditLogs({
						limit: 1,
						type: AuditLogEvent.ChannelOverwriteUpdate,
					});
					auditEntry = fetchedLogs?.entries?.find(
						(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
					);
				}
				if (!auditEntry) {
					fetchedLogs = await oldChannel.guild.fetchAuditLogs({
						limit: 1,
						type: AuditLogEvent.ChannelOverwriteDelete,
					});
					auditEntry = fetchedLogs?.entries?.find(
						(a) => a?.target?.id === oldChannel.id && Date.now() - a.createdTimestamp < 20000
					);
				}
				channelEmbed.setColor("Yellow").addFields({
					name: `${channelType}` + " was updated",
					value: `${newChannel}`,
				});
				if (oldChannel.nsfw !== newChannel.nsfw) {
					channelEmbed.addFields({
						name: "NSFW tag",
						value: oldChannel.nsfw ? "Turned `OFF`" : "Turned `ON`",
					});
				}
				if (oldChannel.name !== newChannel.name) {
					channelEmbed.addFields({
						name: "Name changed",
						value: "From " + `\`${oldChannel.name}\`` + " to " + `\`${newChannel.name}\``,
					});
				}
				if (oldChannel.rawPosition !== newChannel.rawPosition) {
					channelEmbed.addFields({
						name: "Position changed",
						value: "From " + `\`${oldChannel.rawPosition}\`` + " to " + `\`${newChannel.rawPosition}\``,
					});
				}
				if (oldChannel.topic !== newChannel.topic) {
					channelEmbed.addFields({
						name: "Topic changed",
						value:
							"From " +
							(oldChannel.topic ? `\`${oldChannel.topic}\`` : "nothing") +
							" to " +
							(newChannel.topic ? `\`${newChannel.topic}\`` : "nothing"),
					});
				}
				if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
					channelEmbed.addFields({
						name: "Slowmode changed",
						value: "From " + `\`${oldChannel.rateLimitPerUser}\`` + " to " + `\`${newChannel.rateLimitPerUser}\``,
					});
				}
				if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
					channelEmbed.addFields({
						name: "Server region changed",
						value:
							"From " +
							(oldChannel.rtcRegion ? `\`${oldChannel.rtcRegion}\`` : "Auto") +
							" to " +
							(newChannel.rtcRegion ? `\`${newChannel.rtcRegion}\`` : "Auto"),
					});
				}
				if (oldChannel.bitrate !== newChannel.bitrate) {
					channelEmbed.addFields({
						name: "BitRate changed",
						value: "From " + `\`${oldChannel.bitrate}\`` + " to " + `\`${newChannel.bitrate}\``,
					});
				}
				if (oldChannel.userLimit !== newChannel.userLimit) {
					channelEmbed.addFields({
						name: "User Limit changed",
						value: "From " + `\`${oldChannel.userLimit}\`` + " to " + `\`${newChannel.userLimit}\``,
					});
				}
				if (oldChannel.videoQualityMode !== newChannel.videoQualityMode) {
					channelEmbed.addFields({
						name: "Video Quality changed",
						value:
							"From " +
							(oldChannel.videoQualityMode === 1 ? "`Auto`" : "`Full`") +
							" to " +
							(newChannel.videoQualityMode === 1 ? "`Auto`" : "`Full`"),
					});
				}
				let permsChange = false;
				let oldCache = oldChannel.permissionOverwrites.cache;
				let newCache = newChannel.permissionOverwrites.cache;
				if (oldCache.size !== newCache.size) {
					permsChange = true;
				}
				if (!permsChange) {
					oldCache.forEach((oldPerm) => {
						let newPerm = newCache.find((p) => oldPerm.id === p.id);
						if (oldPerm.deny.bitfield !== newPerm.deny.bitfield) {
							permsChange = true;
							return;
						}
						if (oldPerm.allow.bitfield !== newPerm.allow.bitfield) {
							permsChange = true;
							return;
						}
					});
				}
				if (permsChange) {
					let oldString = "";
					let newString = "";
					if (oldCache.size >= newCache.size) {
						await Promise.all(
							oldCache.map(async (role) => {
								let currTarget;
								let currNewRole = newCache.find((u) => u.id === role.id);
								if (!currNewRole) {
									if (role.type === 0) {
										currTarget = await ClientHandler.getClientGuildRole(oldChannel.guild.id, role.id);
									} else if (role.type === 1) {
										currTarget = await ClientHandler.getClientGuildMember(oldChannel.guild.id, role.id);
									}

									let denyRole = ClientHandler.getPermissions(role.deny, 2);
									let allowRole = ClientHandler.getPermissions(role.allow, 2);
									oldString += `${currTarget}` + "\n\n**DENY** : " + denyRole + "\n**ALLOW** : " + allowRole + "\n\n";
									newString += `${currTarget}` + "\n\n**REMOVED**";
								} else if (
									role.deny.bitfield !== currNewRole.deny.bitfield ||
									role.allow.bitfield !== currNewRole.allow.bitfield
								) {
									if (role.type === 0) {
										currTarget = await ClientHandler.getClientGuildRole(oldChannel.guild.id, role.id);
									} else if (role.type === 1) {
										currTarget = await ClientHandler.getClientGuildMember(oldChannel.guild.id, role.id);
									}

									let oldDenyRole = ClientHandler.getPermissions(role.deny, 2);
									let oldAllowRole = ClientHandler.getPermissions(role.allow, 2);
									let newDenyRole = ClientHandler.getPermissions(currNewRole.deny, 2);
									let newAllowRole = ClientHandler.getPermissions(currNewRole.allow, 2);
									oldString +=
										`${currTarget}` + "\n\n**DENY** : " + oldDenyRole + "\n**ALLOW** : " + oldAllowRole + "\n\n";
									newString +=
										`${currTarget}` + "\n\n**DENY** : " + newDenyRole + "\n**ALLOW** : " + newAllowRole + "\n\n";
								}
							})
						);
					} else {
						await Promise.all(
							newCache.map(async (role) => {
								let currTarget;
								let currOldRole = oldCache.find((u) => u.id === role.id);
								if (!currOldRole) {
									if (role.type === 0) {
										currTarget = await ClientHandler.getClientGuildRole(oldChannel.guild.id, role.id);
									} else if (role.type === 1) {
										currTarget = await ClientHandler.getClientGuildMember(oldChannel.guild.id, role.id);
									}

									let denyRole = ClientHandler.getPermissions(role.deny, 2);
									let allowRole = ClientHandler.getPermissions(role.allow, 2);

									oldString += `${currTarget}` + "\n\n**NONE**";
									newString += `${currTarget}` + "\n\n**DENY** : " + denyRole + "\n**ALLOW** : " + allowRole + "\n\n";
								}
							})
						);
					}
					channelEmbed.addFields(
						{
							name: "Old permissions",
							value: `${oldString}`,
							inline: true,
						},
						{
							name: "New permissions",
							value: `${newString}`,
							inline: true,
						}
					);
				}
				channelEmbed.addFields({
					name: "Updated by",
					value: auditEntry?.executor ? `${auditEntry?.executor}` : "Someone",
				});
			}
			this.postAuditEvent(channelEmbed, oldChannel.guild);
		}
	}
	static async auditEventRoles(oldRole, newRole, type) {
		let status = await this.getGuildAuditStatus(oldRole.guild.id);
		if (status) {
			let roleEmbed = new EmbedBuilder()
				.setAuthor({
					name: config.botName,
					iconURL: config.botpfp,
					url: config.botWebsite,
				})
				.setFooter({ text: "Role ID  : " + oldRole.id })
				.setTimestamp();
			if (type === "roleCreate") {
				roleEmbed.addFields({ name: "New role", value: `${oldRole}` });
			} else if (type === "roleDelete") {
				roleEmbed.addFields({
					name: "Deleted role",
					value: `@${oldRole.name}`,
				});
			} else if (type === "roleUpdate") {
				roleEmbed.setDescription(`${newRole}` + " was updated");
				if (oldRole.icon !== newRole.icon) {
					roleEmbed.addFields({
						name: "Updated icon",
						value: `\u200B`,
					});
				}
				if (oldRole.name !== newRole.name) {
					roleEmbed.addFields(
						{
							name: "Old name",
							value: `${oldRole.name}`,
						},
						{
							name: "New name",
							value: `${newRole.name}`,
						}
					);
				}
				if (oldRole.color !== newRole.color) {
					roleEmbed.addFields(
						{
							name: "Old color",
							value: `#${oldRole.color.toString(16)}`,
						},
						{
							name: "New color",
							value: `#${newRole.color.toString(16)}`,
						}
					);
				}
				if (oldRole.hoist !== newRole.hoist) {
					roleEmbed.addFields({
						name: "Hoisted",
						value: "Turned " + (newRole.hoist ? "`ON`" : "`OFF`"),
					});
				}
				if (oldRole.rawPosition !== newRole.rawPosition) {
					roleEmbed.addFields(
						{
							name: "Old position",
							value: `${oldRole.rawPosition}`,
						},
						{
							name: "New position",
							value: `${newRole.rawPosition}`,
						}
					);
				}
				if (oldRole.mentionable !== newRole.mentionable) {
					roleEmbed.addFields({
						name: "Mentionable",
						value: "Turned " + (newRole.mentionable ? "`ON`" : "`OFF`"),
					});
				}
				if (oldRole.permissions !== newRole.permissions) {
					let oldPerms = ClientHandler.getPermissions(oldRole.permissions, 2);
					let newPerms = ClientHandler.getPermissions(newRole.permissions, 2);
					roleEmbed.addFields(
						{
							name: "Old permissions",
							value: `${oldPerms}`,
						},
						{
							name: "New permissions",
							value: `${newPerms}`,
						}
					);
				}
			}
			this.postAuditEvent(roleEmbed, oldRole.guild);
		}
	}
	static async auditEventUserUpdate(oldUser, newUser, client) {
		let avatar = newUser.displayAvatarURL();
		let changeCount = 0;
		let userEmbed = new EmbedBuilder()
			.setAuthor({
				name: newUser.username + "#" + newUser.discriminator,
				iconURL: avatar,
			})
			.setFooter({ text: "User ID  : " + oldUser.id })
			.setDescription(`${newUser}` + " updated their profile")
			.setTimestamp();
		if (oldUser.username !== newUser.username) {
			changeCount++;
			userEmbed.addFields(
				{
					name: "Old username",
					value: `${oldUser.username}`,
					inline: true,
				},
				{
					name: "New username",
					value: `${newUser.username}`,
					inline: true,
				}
			);
		}
		if (oldUser.discriminator !== newUser.discriminator) {
			changeCount++;
			userEmbed.addFields(
				{
					name: "Old discriminator",
					value: `${oldUser.discriminator}`,
					inline: true,
				},
				{
					name: "New discriminator",
					value: `${newUser.discriminator}`,
					inline: true,
				}
			);
		}
		if (oldUser.avatar !== newUser.avatar) {
			changeCount++;
			let oldAvatar = await ClientHandler.getAvatarUrl(oldUser);
			let newAvatar = newUser.displayAvatarURL();
			userEmbed
				.addFields(
					{
						name: "Old avatar",
						value: `[Link](${oldAvatar})`,
						inline: true,
					},
					{
						name: "New avatar (Attached)",
						value: `[Link](${newAvatar})`,
						inline: true,
					}
				)
				.setImage(newAvatar);
		}
		if (changeCount !== 0) {
			client.guilds.cache.forEach(async (guild) => {
				let status = await this.getGuildAuditStatus(guild.id);
				if (status) {
					let memberList = await guild.members.fetch();
					let ifMember = memberList.find((member) => member.user.id === oldUser.id);
					if (ifMember) {
						this.postAuditEvent(userEmbed, guild);
					}
				}
			});
		}
	}
	static async auditEventGuildAuditEntryCreate(event, guild) {
		let status = await this.getGuildAuditStatus(guild.id);
		if (status) {
			let auditEntryEmbed = new EmbedBuilder()
				.setTitle(`Audit Log Entry`)
				.setFooter({ text: "Log ID  : " + event.id })
				.setColor("DarkGreen")
				.addFields(
					{ name: "Action triggered by", value: `${event.executor}` },
					{ name: "Target type", value: `${event.targetType}` },
					{ name: "Action type", value: `${event.actionType}` },
					{ name: "Target", value: `${event.target}` }
				)
				.setTimestamp();
			if (event.reason) {
				auditEntryEmbed.addFields({ name: "Reason", value: `${event.reason}` });
			}
			if (event.changes) {
				event.changes.forEach((e) => {
					if (!e.old && !e.new) {
						return;
					}
					if (e.key === "$add" || e.key === "$remove") {
						let oldVal = e.old ? e.old[0].name : `\`NONE\``;
						let newVal = e.new ? e.new[0].name : `\`NONE\``;
						auditEntryEmbed.addFields({
							name: "Changed",
							value: `\`${e.key}\` changed from \`${oldVal}\` to  \`${newVal}\``,
						});
					} else {
						let oldVal = e.old ? e.old : `\`NONE\``;
						let newVal = e.new ? e.new : `\`NONE\``;
						auditEntryEmbed.addFields({
							name: "Changed",
							value: `\`${e.key}\` changed from \`${oldVal}\` to  \`${newVal}\``,
						});
					}
				});
			}
			this.postAuditEvent(auditEntryEmbed, guild);
		}
	}
}

module.exports = AuditHandler;
